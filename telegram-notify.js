// Cloudflare Worker — scheduled Telegram alerts for the Index Portfolio Dashboard.
//
// What it does (on a cron, even when the site is closed):
//   Telegram теперь получает ТОЛЬКО действия AI-портфеля и авто-анализ:
//     🤖 AI ПОРТФЕЛЬ — 🟢 ПОКУПКА / 🔴 ПРОДАЖА (каждая сделка вирт. портфеля)
//     📈 Анализ портфеля — рекомендации по реальным портфелям (PF3, Anna)
//   Точечные алерты по уровням акций (🟢/🔴/📡 у SMA/поддержки/сопротивления)
//   и сигналы 🕵 cluster-buy / 📐 недооценка / 📊 сценарий УДАЛЕНЫ 2026-06-24:
//   состояние акций смотрим на сайте, не в Telegram (хватит спама).
//   Рекомендуемый cron: */10 6-22 * * 1-5.
//
// ── Setup (≈10 min, free) ───────────────────────────────────────────────
//  Bot:   message @BotFather → /newbot → copy the token.
//  Chat:  message @userinfobot → copy your numeric "Id".
//  Supabase service key: Project Settings → API → service_role (secret!).
//  Deploy: dash.cl Недооценка по мультипликаторамoudflare.com → Workers → Create → paste this → Deploy.
//  Variables (Settings → Variables and Secrets):
//     BOT_TOKEN             (Secret)  – from @BotFather
//     SUPABASE_SERVICE_KEY  (Secret)  – service_role key
//     CHAT_ID               (Text)    – your Telegram chat id
//     SUPABASE_URL          (Text)    – https://<project>.supabase.co
//     NEAR_THRESHOLD        (Text)    – optional, percent proximity to a level (default 10)
//     FMP_KEY               (Secret)  – Financial Modeling Prep API key (analyst targets)
//     ANTHROPIC_API_KEY     (Secret)  – Claude API key (AI Assistant) — console.anthropic.com
//     RESTRICT_FIRMS        (Text)    – optional, set "1" to only average the whitelisted firms
//     FINNHUB_KEY           (Secret)  – Finnhub API key (insider transactions) — finnhub.io
//  Cron: Settings → Triggers → Cron Triggers → add e.g.  30 17 * * 1-5
//        (weekdays 17:30 UTC). Visit the Worker URL any time to test/send now.

const WORKER_BUILD = '2026-06-24aiport-persist';   // ?action=version — проверить, что задеплоено

// Модель на фичу — крути тариф здесь без правки логики. Opus 4.8 на «денежных»
// решениях (анализ/ребаланс/рекомендации), Sonnet 4.6 на болтовне и мониторинге
// индексов (дешевле ~40%, качества достаточно). Неизвестный ключ → дефолт.
const AI_MODEL_DEFAULT = 'claude-opus-4-8';
const MODELS = {
  portfolio: 'claude-opus-4-8',   // aiAnalyze (AI Proto) — анализ портфеля + ребаланс
  dashboard: 'claude-opus-4-8',   // dashboardGen — 📊 AI-Dashboard (правила консистентности)
  aiport:    'claude-opus-4-8',   // aiPortfolio — управление AI-портфелем
  stock:     'claude-opus-4-8',   // stockAnalyze — 🤖 AI-анализ карточки
  reco:      'claude-opus-4-8',   // recoAnalyze — 🔄 AI-Рекомендация
  watchlist: 'claude-sonnet-4-6', // aiAnalyze (watchlist индексов) — простой структурный вывод
  chat:      'claude-sonnet-4-6', // aiChat — диалоговый ассистент
};
const aiModel = k => MODELS[k] || AI_MODEL_DEFAULT;
const PF3_KEY = '🚀 Портфель 3.0';   // portfolio of record
const PF_KEY = '💼 Портфель 2.0';    // legacy key — read fallback only
// Реальные портфели, которые авто-анализируются в цикле AI-портфеля (кнопка
// «Запустить цикл сейчас» + cron) → результат пишется в data[key].analysis,
// клиент рисует его во вкладке «📈 Анализ». Sergei намеренно не включён.
const ANALYZE_PORTFOLIOS = [PF3_KEY, 'Portfolio (Anna)'];
const PFANALYSIS_INTERVAL_MS = 60 * 60e3;   // на cron — не чаще раза в час
const CHART_TICKER = 'MU';   // test mode: send a chart image for this holding only
const FX_DEFAULT = { SEK:1, EUR:10.59, USD:8.93, NOK:0.9375, DKK:1.52 };
const OVERRIDES = { 'NDB':'NDA-SE.ST', 'ASML':'ASML.AS', 'FCT':'FCT.MI', 'FIGMA':'FIG', 'RHM':'RHM.DE', 'RENK':'R3NK.DE', 'DELLIA':'DELIA.OL' };

function exSymbol(ticker, ccy){
  const t = String(ticker || '').trim().toUpperCase().replace(/\s+/g, '-');
  if(OVERRIDES[t]) return OVERRIDES[t];
  if(t.includes('.')) return t;   // уже полный символ биржи (CAC → .PA, MIB → .MI)
  return ({ USD:t, SEK:t+'.ST', NOK:t+'.OL', DKK:t+'.CO', EUR:t+'.DE' })[String(ccy||'').toUpperCase()] || t;
}
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const round2 = n => Math.round(n * 100) / 100;
const FENCE = String.fromCharCode(96, 96, 96);   // тройная обратная кавычка — для встраивания json-блоков в системные промпты
// Стоимость одного прогона из usage ответа Anthropic. Тариф Opus 4.8: $5 / $25
// за 1М входных/выходных токенов; web_search ≈ $0.01 за запрос. Кэш — дешевле
// (creation ×1.25, read ×0.1), но в этих вызовах кэш не используется.
const AI_PRICE = { in: 5, out: 25, search: 0.01 };
function aiCost(j){
  const u = (j && j.usage) || {};
  const inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  const outTok = u.output_tokens || 0;
  const searches = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  const billIn = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1;
  const usd = Math.round((billIn / 1e6 * AI_PRICE.in + outTok / 1e6 * AI_PRICE.out + searches * AI_PRICE.search) * 10000) / 10000;
  return { inTok, outTok, searches, usd };
}
const tgApi = (env, method) => `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;

// Response helpers shared by every route.
const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type, Authorization', 'Content-Type':'application/json; charset=utf-8' };
const json = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: CORS });
const txt = (s, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

// Долгие AI-ответы (web_search + генерация отчёта) не успевают в окно Cloudflare:
// если воркер не начал отвечать ~за 100с, соединение рвётся (524 → «Failed to fetch»).
// Поэтому начинаем ОТДАВАТЬ поток сразу (первый байт + keep-alive переводы строки),
// считаем дальше, а финальный JSON шлём в конце. Клиент читает весь текст и парсит:
// ведущие/хвостовые пробелы безопасны для JSON.parse. Ошибки уходят как {error} (200).
function streamJson(workFn){
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller){
      let live = true;
      const push = s => { try{ controller.enqueue(enc.encode(s)); }catch(_){ live = false; } };
      push(' ');   // первый байт — соединение считается «отвечающим»
      (async () => { while(live){ await sleep(12000); if(live) push('\n'); } })();   // heartbeat
      let out;
      try{ out = await workFn(); }
      catch(e){ out = { error: String((e && e.message) || e) }; }
      live = false;
      push(JSON.stringify(out));
      try{ controller.close(); }catch(_){}
    }
  });
  return new Response(stream, { headers: CORS });
}

// Вызов Claude с устойчивостью к web_search: при stop_reason='pause_turn'
// (долгий серверный поиск) ответ приходит без финального текста — продолжаем
// запрос, докидывая ответ ассистента, пока модель не завершит. usage и
// текстовые блоки суммируем по всем раундам. Возвращает {content, usage}.
// Бюджет веб-ресёрча: после дедлайна — финальный проход БЕЗ поиска (только резюме),
// чтобы не жечь деньги бесконечным поиском. Ответ стримится (см. streamJson), поэтому
// таймаут Cloudflare ~100с больше не ограничивает — можно держать осмысленный бюджет.
const AI_RESEARCH_MS = 90 * 1000;
// Один раунд к Anthropic ЧЕРЕЗ STREAMING (SSE). Долгая генерация отчёта без
// стрима упиралась в таймаут Cloudflare ~100с → 524. Стрим держит соединение
// живым и заодно даёт усечённые usage/content/stop_reason из событий.
// Prompt caching: статический system-промпт оборачиваем в кэшируемый блок
// (cache_control ephemeral, TTL 5 мин). Повторный вызов с тем же префиксом
// читает кэш по ×0.1 вместо ×1 (запись ×1.25) — экономия учтена в aiCost.
// Динамику (снапшот/контекст) держим в messages, не в system, иначе префикс
// меняется и кэш не срабатывает. Минимум для кэша: Opus 4.8 ~4096 ток.,
// Sonnet 4.6 ~2048 — крупные промпты (AI/AIPORT/PFANALYZE/...) выше порога.
function cacheSys(s){
  if(typeof s === 'string' && s) return [{ type: 'text', text: s, cache_control: { type: 'ephemeral' } }];
  return s;   // уже массив блоков или пусто — не трогаем
}
async function anthropicRound(env, body){
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, system: cacheSys(body.system), stream: true }),
  });
  if(!r.ok || !r.body){ const e = new Error('Claude API ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 200)); e.status = r.status; throw e; }
  const reader = r.body.getReader(), dec = new TextDecoder();
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 0 } };
  let buf = '', blocks = [], partial = {}, stop_reason = null;
  for(;;){
    const { done, value } = await reader.read();
    if(done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while((i = buf.indexOf('\n\n')) >= 0){
      const blk = buf.slice(0, i); buf = buf.slice(i + 2);
      for(const ln of blk.split('\n')){
        if(!ln.startsWith('data:')) continue;
        const data = ln.slice(5).trim(); if(!data || data === '[DONE]') continue;
        let ev; try{ ev = JSON.parse(data); }catch(e){ continue; }
        if(ev.type === 'message_start'){ const u = ev.message && ev.message.usage; if(u){ usage.input_tokens += u.input_tokens || 0; usage.cache_creation_input_tokens += u.cache_creation_input_tokens || 0; usage.cache_read_input_tokens += u.cache_read_input_tokens || 0; } }
        else if(ev.type === 'content_block_start'){ blocks[ev.index] = ev.content_block ? JSON.parse(JSON.stringify(ev.content_block)) : { type: 'text', text: '' }; partial[ev.index] = ''; }
        else if(ev.type === 'content_block_delta'){ const d = ev.delta || {}, b = blocks[ev.index] || (blocks[ev.index] = { type: 'text', text: '' });
          if(d.type === 'text_delta') b.text = (b.text || '') + (d.text || '');
          else if(d.type === 'thinking_delta') b.thinking = (b.thinking || '') + (d.thinking || '');
          else if(d.type === 'input_json_delta') partial[ev.index] = (partial[ev.index] || '') + (d.partial_json || '');
          else if(d.type === 'signature_delta') b.signature = (b.signature || '') + (d.signature || ''); }
        else if(ev.type === 'content_block_stop'){ const b = blocks[ev.index]; if(b && partial[ev.index]){ try{ b.input = JSON.parse(partial[ev.index]); }catch(e){} } }
        else if(ev.type === 'message_delta'){ if(ev.delta && ev.delta.stop_reason) stop_reason = ev.delta.stop_reason; const u = ev.usage; if(u){ usage.output_tokens += u.output_tokens || 0; if(u.server_tool_use && typeof u.server_tool_use.web_search_requests === 'number') usage.server_tool_use.web_search_requests += u.server_tool_use.web_search_requests; } }
        else if(ev.type === 'error'){ throw new Error('Claude API stream: ' + JSON.stringify(ev.error || {}).slice(0, 150)); }
      }
    }
  }
  return { content: blocks.filter(Boolean), usage, stop_reason };
}
async function anthropicRun(env, body){
  const started = Date.now();
  let messages = (body.messages || []).slice();
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 0 } };
  let content = [];
  let summarize = false;   // дедлайн ресёрча истёк — последний раунд без инструментов
  for(let round = 0; round < 6; round++){
    // В режиме summarize убираем tools → модель не ищет, а сводит найденное.
    const reqBody = summarize ? { ...body, tools: undefined, messages } : { ...body, messages };
    let j = null, lastErr = '';
    for(let attempt = 0; attempt < 4; attempt++){
      try{ j = await anthropicRound(env, reqBody); break; }
      catch(e){ lastErr = String(e.message || e); const st = e.status || 0;
        const retr = st === 429 || st >= 500 || /network|сеть|stream|timeout|524|529/i.test(lastErr);
        if(retr && attempt < 3){ await sleep(1500 * Math.pow(2, attempt)); continue; }
        throw new Error(lastErr); }
    }
    if(!j) throw new Error(lastErr || 'Claude API: нет ответа после ретраев');
    const u = j.usage || {};
    usage.input_tokens += u.input_tokens || 0;
    usage.output_tokens += u.output_tokens || 0;
    usage.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
    usage.cache_read_input_tokens += u.cache_read_input_tokens || 0;
    usage.server_tool_use.web_search_requests += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
    content = content.concat(j.content || []);
    if(!summarize && j.stop_reason === 'pause_turn'){
      messages = messages.concat([{ role: 'assistant', content: j.content }]);
      // Лимит на ресёрч: израсходовали ~90 секунд → просим свести найденное БЕЗ новых поисков.
      if(Date.now() - started > AI_RESEARCH_MS){
        messages = messages.concat([{ role: 'user', content: 'Лимит веб-поиска (~90 секунд) исчерпан. БОЛЬШЕ НЕ ИЩИ. Сведи уже найденную информацию и данные снапшота в финальный ответ строго в требуемом формате — кратко, по делу, с конкретикой и уровнями.' }]);
        summarize = true;
      }
      continue;
    }
    break;
  }
  return { content, usage };
}

// Fetch a Yahoo Finance chart and return chart.result[0] (or null on any failure).
const YH_HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
async function yChart(sym, interval, range){
  try{
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${interval}&range=${range}`, { headers: YH_HEADERS });
    if(!r.ok) return null;
    return (await r.json())?.chart?.result?.[0] || null;
  }catch(e){ return null; }
}
// Simple moving averages over a close series.
const smaLast = (closes, n) => { if(closes.length < n) return null; let s = 0; for(let i = closes.length - n; i < closes.length; i++) s += closes[i]; return round2(s / n); };                                    // average of the last n
const smaSeries = (closes, n) => { const o = new Array(closes.length).fill(null); let s = 0; for(let i = 0; i < closes.length; i++){ s += closes[i]; if(i >= n) s -= closes[i - n]; if(i >= n - 1) o[i] = round2(s / n); } return o; };   // rolling, aligned with closes

// One year of daily candles → current price, day change %, SMA 50/100/200,
// and support / resistance (rolling 3-month low/high). All in native currency,
// matching the price column; fields are null when there isn't enough history.
const SR_WINDOW = 60;   // trading days (~3 months) for support/resistance
async function yahoo(sym){
  try{
    const res = await yChart(sym, '1d', '1y');
    const m = res?.meta;
    if(!m || typeof m.regularMarketPrice !== 'number') return null;
    const q = res?.indicators?.quote?.[0] || {};
    const rawC = q.close || [], ts = res.timestamp || [];
    const closes = rawC.filter(v => typeof v === 'number' && v > 0);
    const lows = (q.low || []).filter(v => typeof v === 'number' && v > 0).slice(-SR_WINDOW);
    const highs = (q.high || []).filter(v => typeof v === 'number' && v > 0).slice(-SR_WINDOW);
    let price = m.regularMarketPrice, pct = null, vol = null, avgVol = null;
    // День%: АВТОРИТЕТНЫЙ regularMarketChangePercent из quote-меты Yahoo (как на
    // finance.yahoo.com). Chart-расчёт ненадёжен при пропусках/null в дневном ряду
    // (^OMX пропускает день; US-акции дают null на сегодняшнюю свечу) — давал «2-дневный» %.
    try{
      const qs = await yQuoteSummary(sym, 'price,summaryDetail');
      const p = qs && qs.price, sd = qs && qs.summaryDetail;
      if(p){
        const rp = yRaw(p.regularMarketPrice); if(typeof rp === 'number' && rp > 0) price = rp;
        const cp = yRaw(p.regularMarketChangePercent); if(typeof cp === 'number') pct = round2(cp * 100);
        vol = yRaw(p.regularMarketVolume);                                          // объём за день (лайв)
      }
      // Средний дневной объём (для «×ср.») живёт в summaryDetail, НЕ в price.
      avgVol = (sd && (yRaw(sd.averageDailyVolume3Month) || yRaw(sd.averageVolume) || yRaw(sd.averageDailyVolume10Day) || yRaw(sd.averageVolume10days)))
            || (p && (yRaw(p.averageDailyVolume3Month) || yRaw(p.averageDailyVolume10Day))) || null;
    }catch(e){}
    if(vol == null && typeof m.regularMarketVolume === 'number') vol = m.regularMarketVolume;   // fallback из chart-меты
    if(pct == null){   // fallback: последнее дневное закрытие строго ДО сегодня из 1y-ряда
      const todayUTC = new Date().toISOString().slice(0, 10);
      let prev = null;
      for(let i = rawC.length - 1; i >= 0; i--){
        const c = rawC[i]; if(!(typeof c === 'number' && c > 0)) continue;
        const dstr = ts[i] ? new Date(ts[i] * 1000).toISOString().slice(0, 10) : '';
        if(dstr && dstr < todayUTC){ prev = c; break; }
      }
      if(prev == null) prev = closes.length >= 2 ? closes[closes.length - 2] : (m.chartPreviousClose || m.previousClose);
      pct = (prev && prev > 0) ? (price - prev) / prev * 100 : null;
    }
    return {
      price, pct, vol, avgVol,
      sma50: smaLast(closes, 50), sma100: smaLast(closes, 100), sma200: smaLast(closes, 200),
      support: lows.length ? round2(Math.min(...lows)) : null,
      resistance: highs.length ? round2(Math.max(...highs)) : null,
    };
  }catch(e){ return null; }
}

// Weekly-bar SMA 50/100/200 (~1yr / 2yr / 3.8yr) — powers the dashboard's 3-year SMA view.
async function weeklySMA(sym){
  const res = await yChart(sym, '1wk', '5y');
  if(!res) return null;
  const closes = (res.indicators?.quote?.[0]?.close || []).filter(v => typeof v === 'number' && v > 0);
  return { sma50w: smaLast(closes, 50), sma100w: smaLast(closes, 100), sma200w: smaLast(closes, 200) };
}

// Daily closes for one symbol over `range` → { t:[unix secs], c:[closes] } (or null).
// ── 📉 Implied move из опционов (ATM-стрэддл ближайшей экспирации) ──
// Чистая функция: спот + цепочки call/put + дата экспирации → ожидаемый ход %.
// Покрыта тестом.
function impliedMove(spot, calls, puts, expMs, nowMs){
  if(!(spot > 0) || !Array.isArray(calls) || !Array.isArray(puts)) return null;
  const near = arr => arr.filter(o => o && +o.strike > 0).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
  const c = near(calls), p = near(puts);
  if(!c || !p) return null;
  const px = o => { const b = +o.bid, a = +o.ask, l = +o.lastPrice; if(b > 0 && a > 0) return (b + a) / 2; return l > 0 ? l : 0; };
  const straddle = px(c) + px(p);
  if(!(straddle > 0)) return null;
  const movePct = straddle / spot * 100;
  const days = Math.max(0, Math.round((expMs - nowMs) / 864e5));
  const ivc = +c.impliedVolatility || 0, ivp = +p.impliedVolatility || 0, iv = (ivc + ivp) / 2;
  return { movePct: Math.round(movePct * 10) / 10, days, atm: Math.round(((+c.strike + +p.strike) / 2) * 100) / 100, iv: iv > 0 ? Math.round(iv * 1000) / 10 : null };
}
// Ближайшая экспирация, покрывающая дату отчёта: первая, чья КАЛЕНДАРНАЯ дата ≥ дня отчёта.
// (сравнение по дню, чтобы тайзоны не уводили на недельную экспирацию перед отчётом).
function pickEarnExpiry(expDatesMs, earnMs){
  if(!(earnMs > 0) || !Array.isArray(expDatesMs)) return 0;
  const day = ms => Math.floor(ms / 864e5), ed = day(earnMs);
  const fut = expDatesMs.filter(ms => day(ms) >= ed).sort((a, b) => a - b);
  return fut.length ? fut[0] : 0;
}
async function optionsImplied(symbol){
  try{
    // v7 options теперь требует crumb+cookie (как quoteSummary), иначе 401 Invalid Crumb.
    const a = await yAuth(); if(!a) return null;
    const r = await fetch(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(a.crumb)}`,
      { headers: { ...Y_UA, Cookie: a.cookie } });
    if(!r.ok){ if(r.status === 401 || r.status === 403) _yAuth = null; return null; }
    const j = await r.json();
    const res = j && j.optionChain && j.optionChain.result && j.optionChain.result[0];
    if(!res) return null;
    const spot = (res.quote && res.quote.regularMarketPrice) || 0;
    const opt = res.options && res.options[0];
    if(!opt || !(spot > 0)) return null;
    const nowMs = Date.now();
    const expMs = (opt.expirationDate || 0) * 1000;
    const im = impliedMove(spot, opt.calls, opt.puts, expMs, nowMs);
    if(!im) return null;
    const out = { ...im, expiry: new Date(expMs).toISOString().slice(0, 10), spot: round2(spot), at: new Date().toISOString() };
    // 📅 Ход на отчёт: implied move у экспирации, покрывающей дату ближайшего отчёта.
    try{
      let earnMs = (+(res.quote && res.quote.earningsTimestamp) || 0) * 1000;
      if(!(earnMs >= nowMs - 864e5)){   // нет в quote или уже прошёл — берём из calendarEvents
        const cal = await yQuoteSummary(symbol, 'calendarEvents');
        const ed = cal && cal.calendarEvents && cal.calendarEvents.earnings && cal.calendarEvents.earnings.earningsDate;
        earnMs = (Array.isArray(ed) && ed.length) ? (yRaw(ed[0]) || 0) * 1000 : 0;
      }
      if(earnMs >= nowMs - 864e5){   // только предстоящий отчёт (допуск — сегодня)
        const expDates = (res.expirationDates || []).map(s => s * 1000);
        const eExpMs = pickEarnExpiry(expDates, earnMs);
        if(eExpMs > 0){
          let eOpt = (eExpMs === expMs) ? opt : null;   // совпала с ближайшей — без лишнего запроса
          if(!eOpt){
            const r2 = await fetch(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?date=${Math.round(eExpMs / 1000)}&crumb=${encodeURIComponent(a.crumb)}`,
              { headers: { ...Y_UA, Cookie: a.cookie } });
            if(r2.ok){ const res2 = (await r2.json())?.optionChain?.result?.[0]; eOpt = res2 && res2.options && res2.options[0]; }
          }
          if(eOpt){
            const eim = impliedMove(spot, eOpt.calls, eOpt.puts, eExpMs, nowMs);
            if(eim) out.earn = { date: new Date(earnMs).toISOString().slice(0, 10), expiry: new Date(eExpMs).toISOString().slice(0, 10), movePct: eim.movePct, days: eim.days, iv: eim.iv };
          }
        }
      }
    }catch(e){}
    return out;
  }catch(e){ return null; }
}
// ── 📐 Уровни индексов: поддержка/сопротивление (daily pivots + свинги окна) ──
// Чистая функция: цена + дневные H/L/C → ближайшие S/R по обе стороны цены.
// Схлопывает близкие уровни (в пределах 0.3%); до 2 сопротивлений выше и 2 поддержек ниже.
function collapseLevels(arr, tol){
  const s = arr.filter(v => v > 0 && isFinite(v)).sort((a, b) => a - b), out = [];
  for(const v of s){ if(!out.length || Math.abs(v - out[out.length - 1]) / out[out.length - 1] > tol) out.push(v); }
  return out;
}
function indexLevels(price, closes, highs, lows){
  price = +price;
  if(!(price > 0) || !Array.isArray(closes) || closes.length < 2) return null;
  highs = Array.isArray(highs) ? highs : []; lows = Array.isArray(lows) ? lows : [];
  const C = closes[closes.length - 1], H = highs.length ? highs[highs.length - 1] : 0, L = lows.length ? lows[lows.length - 1] : 0;
  const cand = []; let pivot = null;
  if(H > 0 && L > 0 && C > 0){
    const P = (H + L + C) / 3; pivot = round2(P);
    cand.push(2 * P - L, 2 * P - H, P + (H - L), P - (H - L));   // R1, S1, R2, S2
  }
  const W = Math.min(SR_WINDOW, closes.length);
  if(highs.length) cand.push(Math.max(...highs.slice(-W)));   // свинг-хай окна → сопротивление
  if(lows.length)  cand.push(Math.min(...lows.slice(-W)));    // свинг-лоу окна → поддержка
  const res = collapseLevels(cand.filter(v => v > price), 0.003).slice(0, 2).map(round2);            // выше цены, ближайший первым
  const sup = collapseLevels(cand.filter(v => v < price), 0.003).sort((a, b) => b - a).slice(0, 2).map(round2); // ниже цены, ближайший первым
  return { pivot, res, sup };
}
// ── 📰 Новости акции (Yahoo Finance search) — заголовки в реальном времени ──
// Чистый парсер ответа Yahoo search → нормализованный список заголовков (тестируемо).
function newsItemsFromYahoo(j){
  const news = (j && Array.isArray(j.news)) ? j.news : [];
  return news.map(n => ({
    title: String((n && n.title) || '').trim().slice(0, 220),
    publisher: String((n && n.publisher) || '').trim(),
    link: String((n && n.link) || ''),
    time: (n && typeof n.providerPublishTime === 'number') ? n.providerPublishTime * 1000 : 0,
  })).filter(x => x.title).slice(0, 10);
}
let _newsCache = {};
async function stockNews(symbol){
  const c = _newsCache[symbol];
  if(c && Date.now() - c.at < 600000) return c.data;   // TTL 10 мин
  const a = await yAuth();   // search иногда требует cookie/crumb
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=12&quotesCount=0&enableFuzzyQuery=false`;
  const r = await fetch(url, { headers: a ? { ...Y_UA, Cookie: a.cookie } : Y_UA });
  if(!r.ok){ if(r.status === 401 || r.status === 403) _yAuth = null; return null; }
  let j = null; try{ j = await r.json(); }catch(e){ return null; }
  const data = { items: newsItemsFromYahoo(j), at: new Date().toISOString() };
  _newsCache[symbol] = { data, at: Date.now() };
  return data;
}
// Кэш уровней (S/R меняются медленно) — на изолят, TTL 10 мин.
let _levelsCache = {};
async function levelsFor(sym){
  const c = _levelsCache[sym];
  if(c && Date.now() - c.at < 600000) return c.data;
  const res = await yChart(sym, '1d', '1y');
  const m = res?.meta;
  if(!m || typeof m.regularMarketPrice !== 'number') return null;
  const q = res?.indicators?.quote?.[0] || {};
  const closes = (q.close || []).filter(v => typeof v === 'number' && v > 0);
  const highs = (q.high || []).filter(v => typeof v === 'number' && v > 0);
  const lows = (q.low || []).filter(v => typeof v === 'number' && v > 0);
  const price = m.regularMarketPrice;
  const lv = indexLevels(price, closes, highs, lows);
  if(!lv) return null;
  const pct = typeof m.regularMarketChangePercent === 'number' ? round2(m.regularMarketChangePercent * 100) : null;
  const data = { price: round2(price), pct, sma50: smaLast(closes, 50), sma200: smaLast(closes, 200), ...lv, at: new Date().toISOString() };
  _levelsCache[sym] = { data, at: Date.now() };
  return data;
}
async function dailyHistory(sym, range = '2y'){
  const res = await yChart(sym, '1d', range);
  if(!res) return null;
  const ts = res.timestamp || [], cl = res.indicators?.quote?.[0]?.close || [];
  const t = [], c = [];
  for(let i = 0; i < cl.length; i++){ if(typeof cl[i] === 'number' && cl[i] > 0){ t.push(ts[i]); c.push(round2(cl[i])); } }
  return c.length ? { t, c } : null;
}

// ── 🔄 Live Sector Tracker: 11 GICS-секторов через SPDR ETF + бенчмарк SPY ──
// Прокси секторов — стандарт рынка. Источник — Yahoo (как везде в дашборде),
// один запрос chart на тикер даёт и живую цену, и 1y-историю для периодов.
const SECTOR_ETFS = [
  ['XLK', 'Information Technology', 'Технологии'],
  ['XLV', 'Health Care', 'Здравоохранение'],
  ['XLF', 'Financials', 'Финансы'],
  ['XLY', 'Consumer Discretionary', 'Потреб. цикличные'],
  ['XLC', 'Communication Services', 'Коммуникации'],
  ['XLI', 'Industrials', 'Промышленность'],
  ['XLP', 'Consumer Staples', 'Потреб. защитные'],
  ['XLE', 'Energy', 'Энергетика'],
  ['XLU', 'Utilities', 'Коммун. услуги'],
  ['XLRE', 'Real Estate', 'Недвижимость'],
  ['XLB', 'Materials', 'Материалы'],
];
const SECTOR_BENCH = 'SPY';
async function sectorMetrics(sym){
  const res = await yChart(sym, '1d', '1y');
  const m = res && res.meta;
  if(!m || typeof m.regularMarketPrice !== 'number') return null;
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const ts = res.timestamp || [], rawc = q.close || [];
  const closes = [], times = [];
  for(let i = 0; i < rawc.length; i++){ if(typeof rawc[i] === 'number' && rawc[i] > 0){ closes.push(rawc[i]); times.push(ts[i]); } }
  const n = closes.length; if(!n) return null;
  let price = m.regularMarketPrice, dayPctAuth = null;
  // День%: авторитетный regularMarketChangePercent (как в yahoo()); chart — fallback.
  try{
    const p = (await yQuoteSummary(sym, 'price'))?.price;
    if(p){ const rp = yRaw(p.regularMarketPrice); if(typeof rp === 'number' && rp > 0) price = rp;
      const cp = yRaw(p.regularMarketChangePercent); if(typeof cp === 'number') dayPctAuth = round2(cp * 100); }
  }catch(e){}
  const todayUTC = new Date().toISOString().slice(0, 10);
  let prev = null;
  for(let i = n - 1; i >= 0; i--){ const dstr = times[i] ? new Date(times[i] * 1000).toISOString().slice(0, 10) : ''; if(dstr && dstr < todayUTC){ prev = closes[i]; break; } }
  if(prev == null) prev = n >= 2 ? closes[n - 2] : (m.chartPreviousClose || m.previousClose || price);
  const ret = base => (base > 0) ? round2((price / base - 1) * 100) : null;
  const back = k => (n - 1 - k >= 0) ? closes[n - 1 - k] : closes[0];
  const curYear = new Date((m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now())).getUTCFullYear();
  let ytdBase = null;
  for(let i = times.length - 1; i >= 0; i--){ if(times[i] && new Date(times[i] * 1000).getUTCFullYear() < curYear){ ytdBase = closes[i]; break; } }
  const sma = p => { if(n < p) return null; let s = 0; for(let i = n - p; i < n; i++) s += closes[i]; return s / p; };
  return {
    price: round2(price), dayPct: (dayPctAuth != null) ? dayPctAuth : ((prev > 0) ? round2((price / prev - 1) * 100) : null),
    w1: ret(back(5)), m1: ret(back(21)), m3: ret(back(63)), ytd: ytdBase ? ret(ytdBase) : null,
    sma20: sma(20), sma50: sma(50), marketState: m.marketState || null,
  };
}
async function sectorTracker(){
  const syms = SECTOR_ETFS.map(s => s[0]).concat([SECTOR_BENCH]);
  const map = {};
  await Promise.all(syms.map(async sym => { map[sym] = await sectorMetrics(sym).catch(() => null); }));
  const spy = map[SECTOR_BENCH];
  const rel = (a, b) => (a != null && b != null) ? round2(a - b) : null;
  const sectors = SECTOR_ETFS.map(([etf, en, ru]) => {
    const s = map[etf];
    if(!s) return { etf, en, ru, ok: false };
    const trend = (s.sma20 != null && s.sma50 != null)
      ? (s.price >= s.sma20 && s.sma20 >= s.sma50 ? 'up' : (s.price < s.sma20 && s.sma20 < s.sma50 ? 'down' : 'side'))
      : 'side';
    return { etf, en, ru, ok: true, price: s.price, dayPct: s.dayPct, w1: s.w1, m1: s.m1, m3: s.m3, ytd: s.ytd, trend,
      vsSpy: spy ? { day: rel(s.dayPct, spy.dayPct), w1: rel(s.w1, spy.w1), m1: rel(s.m1, spy.m1), m3: rel(s.m3, spy.m3), ytd: rel(s.ytd, spy.ytd) } : null };
  });
  return { at: Date.now(), marketState: (spy && spy.marketState) || null,
    bench: spy ? { etf: SECTOR_BENCH, dayPct: spy.dayPct, w1: spy.w1, m1: spy.m1, m3: spy.m3, ytd: spy.ytd } : null,
    sectors };
}

// ── 📈 Живые фьючерсы/индексы для AI-анализа: направление риска ПРЯМО СЕЙЧАС ──
// US-фьючерсы (=F) идут ~23ч (в т.ч. пре-маркет), VIX/сырьё — барометр риска,
// доходности US-облигаций (^TNX 10Y, ^IRX 13-нед = прокси fed funds) и индекс
// доллара (DX=F) — ПРЯМОЙ канал реакции на FED, спот-индексы (^…) — в часы
// своей биржи. ^TNX/^IRX приходят в десятых долях процента (42.1 = 4.21%).
// price + дневное изменение %.
const AI_MARKETS = [
  ['ES=F','S&P 500 fut'],['NQ=F','Nasdaq 100 fut'],['YM=F','Dow fut'],['RTY=F','Russell 2000 fut'],
  ['GC=F','Gold'],['CL=F','WTI Oil'],['^VIX','VIX'],
  ['^TNX','US 10Y yield'],['^IRX','US 13w T-bill'],['DX=F','US Dollar idx'],
  ['^OMX','OMXS30'],['^GDAXI','DAX'],['^STOXX50E','Euro Stoxx 50'],['^N225','Nikkei 225'],
];
async function liveMarkets(){
  const out = [];
  await Promise.all(AI_MARKETS.map(async ([sym, name]) => {
    try{ const q = await yahoo(sym); if(q && typeof q.price === 'number') out.push({ name, price: round2(q.price), dayPct: typeof q.pct === 'number' ? round2(q.pct) : null }); }catch(e){}
  }));
  return out;
}

// Портфель 3.0 is the portfolio of record; fall back to 2.0 for old states.
async function loadPortfolio(env){
  const row = await loadRow(env);
  const snap = row && row.snap;
  const pf = snap && snap.data && (snap.data[PF3_KEY] || snap.data[PF_KEY]);
  if(!pf) return null;
  return { rows: pf.rows, fx: snap.fx || FX_DEFAULT };
}

async function sendTelegram(env, text){
  const r = await fetch(tgApi(env, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if(!r.ok) throw new Error('Telegram send failed: ' + r.status + ' ' + (await r.text()));
}

// Upload PNG bytes to Telegram (multipart). More reliable than passing a URL,
// which Telegram has to fetch itself (and often fails on dynamic chart URLs).
async function sendPhoto(env, bytes, caption){
  const form = new FormData();
  form.append('chat_id', String(env.CHAT_ID));
  if(caption){ form.append('caption', caption); form.append('parse_mode', 'HTML'); }
  form.append('photo', new Blob([bytes], { type: 'image/png' }), 'chart.png');
  const r = await fetch(tgApi(env, 'sendPhoto'), { method: 'POST', body: form });
  if(!r.ok) throw new Error('Telegram photo failed: ' + r.status + ' ' + (await r.text()));
}

// Render a price + SMA 50/100/200 + support/resistance chart via QuickChart → PNG bytes (ArrayBuffer) or null.
async function chartPng(sym, name, support, resistance){
  const h = await dailyHistory(sym);
  if(!h) return null;
  const WIN = Math.min(252, h.c.length), st = h.c.length - WIN, sl = a => a.slice(st);
  // Downsample to ≤~80 points — QuickChart's free endpoint 400s on very large configs.
  const step = Math.max(1, Math.ceil(WIN / 80)), dn = a => a.filter((_, i) => i % step === 0);
  const C = dn(sl(h.c)), A = dn(sl(smaSeries(h.c, 50))), B = dn(sl(smaSeries(h.c, 100))), D = dn(sl(smaSeries(h.c, 200))), T = dn(sl(h.t));
  const N = C.length;
  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const labels = T.map(x => { const d = new Date(x * 1000); return `${MO[d.getUTCMonth()]} ${d.getUTCDate()}`; });
  const flat = v => (typeof v === 'number' && isFinite(v)) ? new Array(N).fill(v) : null;
  const ds = (label, data, color, dash) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: dash ? 1.5 : 2, pointRadius: 0, fill: false, ...(dash ? { borderDash: [6, 4] } : {}) });
  const datasets = [ ds('Price', C, '#111827'), ds('SMA 50', A, '#2563eb'), ds('SMA 100', B, '#f59e0b'), ds('SMA 200', D, '#7c3aed') ];
  if(flat(support)) datasets.push(ds('Support', flat(support), '#16a34a', true));
  if(flat(resistance)) datasets.push(ds('Resistance', flat(resistance), '#dc2626', true));
  const config = { type: 'line', data: { labels, datasets },
    options: { plugins: { title: { display: true, text: name }, legend: { position: 'bottom' } },
               scales: { x: { ticks: { maxTicksLimit: 8, autoSkip: true } } }, elements: { line: { tension: 0.1 } } } };
  try{
    const r = await fetch('https://quickchart.io/chart', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart: config, width: 820, height: 440, backgroundColor: 'white', format: 'png' }),
    });
    if(!r.ok) return null;
    return await r.arrayBuffer();
  }catch(e){ return null; }
}

// Test mode: send a chart photo for CHART_TICKER (live support/resistance from yahoo()).
async function sendChartMU(env){
  const pf = await loadPortfolio(env);
  if(!pf) return false;
  const row = pf.rows.find(r => String(r[2] || '').trim().toUpperCase() === CHART_TICKER);
  if(!row) return false;
  const sym = exSymbol(row[2], row[8]), ccy = row[8] || '';
  const q = await yahoo(sym);
  const png = await chartPng(sym, String(row[1] || CHART_TICKER), q && q.support, q && q.resistance);
  if(!png) return false;
  const px = q && typeof q.price === 'number' ? ` — ${q.price} ${ccy}` : '';
  await sendPhoto(env, png, `📈 <b>${esc(String(row[1] || CHART_TICKER))}</b> (${CHART_TICKER})${px}`);
  return true;
}

// Portfolio row schema (indices): 1 name · 2 ticker · 8 ccy
// Alert when the live price is within ±NEAR_THRESHOLD% of any technical level
// (SMA 50/100/200, support, resistance). Silent when nothing is close.
async function buildReport(env){
  const pf = await loadPortfolio(env);
  if(!pf) return null;
  const nearPct = parseFloat(env.NEAR_THRESHOLD || '10');
  const blocks = [];

  // All quotes in parallel (Yahoo handles this fine; the ?symbols= endpoint already does the same).
  const quotes = await Promise.all(pf.rows.map(row => yahoo(exSymbol(row[2], row[8]))));
  for(let ri = 0; ri < pf.rows.length; ri++){
    const row = pf.rows[ri];
    const name = esc(row[1]), ccy = row[8];
    const q = quotes[ri];
    if(!q || typeof q.price !== 'number' || q.price <= 0) continue;
    const price = q.price;
    const levels = [
      ['SMA 50', q.sma50], ['SMA 100', q.sma100], ['SMA 200', q.sma200],
      ['Поддержка', q.support], ['Сопротивление', q.resistance],
    ];
    const near = [];
    for(const [label, val] of levels){
      if(typeof val !== 'number' || val <= 0) continue;
      const dist = (price - val) / val * 100;   // price above (+) / below (−) the level
      if(Math.abs(dist) <= nearPct) near.push({ label, val, dist });
    }
    if(!near.length) continue;
    near.sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist));   // nearest level first
    const lines = near.map(n => {
      const dot = n.dist >= 0 ? '🟢' : '🔴';                    // above level / below level
      const arrow = n.dist >= 0 ? '▲' : '▼';
      return `${dot} ${n.label} <code>${n.val}</code> ${arrow} <b>${Math.abs(n.dist).toFixed(1)}%</b>`;
    });
    blocks.push(`🏢 <b>${name}</b> · <b>${price}</b> ${ccy}\n` + lines.join('\n'));
  }

  if(!blocks.length) return null;
  return `📈 <b>Цена рядом с уровнями</b>  ±${nearPct}%\n`
       + `<i>🟢 цена выше уровня · 🔴 цена ниже уровня</i>\n\n`
       + blocks.join('\n\n');
}

// ── Yahoo fallback for fundamentals / earnings ──────────────────────────────
// FMP covers mostly US tickers; for EU/Nordic stocks (RHM.DE, .ST, .OL, .CO)
// we fall back to Yahoo: quoteSummary needs a crumb+cookie pair (cached per
// isolate), the revenue timeseries endpoint needs no auth at all.
let _yAuth = null;
// Browser-like headers — Yahoo is picky about bare UAs coming from datacenter IPs.
const Y_UA = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};
async function yAuth(log){
  if(_yAuth) return _yAuth;
  const dbg = log || (() => {});
  try{
    let cookie = '';
    for(const u of ['https://fc.yahoo.com/', 'https://finance.yahoo.com/']){
      const r = await fetch(u, { headers: Y_UA, redirect: 'manual' });
      cookie = (r.headers.get('set-cookie') || '').split(';')[0];
      dbg(`cookie via ${u}: status ${r.status}, cookie ${cookie ? cookie.slice(0, 24) + '…' : 'NONE'}`);
      if(cookie) break;
    }
    if(!cookie) return null;
    for(const host of ['query1', 'query2']){
      const r2 = await fetch(`https://${host}.finance.yahoo.com/v1/test/getcrumb`, { headers: { ...Y_UA, Cookie: cookie } });
      const crumb = r2.ok ? (await r2.text()).trim() : '';
      dbg(`crumb via ${host}: status ${r2.status}, crumb ${crumb && !crumb.includes('<') ? 'OK' : 'EMPTY/HTML'}`);
      if(crumb && !crumb.includes('<')) return _yAuth = { cookie, crumb };
    }
    return null;
  }catch(e){ dbg('yAuth exception: ' + (e.message || e)); return null; }
}
async function yQuoteSummary(sym, modules){
  const a = await yAuth(); if(!a) return null;
  try{
    const r = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}&crumb=${encodeURIComponent(a.crumb)}`,
      { headers: { ...Y_UA, Cookie: a.cookie } });
    if(!r.ok){ if(r.status === 401 || r.status === 403) _yAuth = null; return null; }
    return (await r.json())?.quoteSummary?.result?.[0] || null;
  }catch(e){ return null; }
}
const yRaw = v => (v && typeof v === 'object') ? (typeof v.raw === 'number' ? v.raw : null) : (typeof v === 'number' ? v : null);
// Annual or quarterly total-revenue history (oldest → newest), no auth needed.
async function yRevenueSeries(sym, quarterly){
  try{
    const t = quarterly ? 'quarterlyTotalRevenue' : 'annualTotalRevenue';
    const now = Math.floor(Date.now() / 1000);
    const r = await fetch(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(sym)}?type=${t}&period1=${now - 8 * 365 * 86400}&period2=${now}`, { headers: Y_UA });
    if(!r.ok) return [];
    const res = (await r.json())?.timeseries?.result?.[0];
    return (res?.[t] || []).filter(x => x && x.reportedValue && typeof x.reportedValue.raw === 'number')
      .map(x => ({ date: x.asOfDate, v: x.reportedValue.raw }));
  }catch(e){ return []; }
}
// Same shape as the FMP fundamentals() result. financialData values are TTM/current.
async function yahooFundamentals(sym, period){
  const qtrMode = period === 'quarter';
  const [qs, ann, qtr] = await Promise.all([
    yQuoteSummary(sym, 'financialData'),
    yRevenueSeries(sym, false),
    qtrMode ? yRevenueSeries(sym, true) : [],
  ]);
  const fd = qs && qs.financialData;
  if(!fd && !ann.length) return null;
  const last = ann[ann.length - 1];
  const years = ann.length - 1;
  const cagr = (ann[0] && last && ann[0].v > 0 && years > 0) ? (Math.pow(last.v / ann[0].v, 1 / years) - 1) * 100 : null;
  const de = yRaw(fd?.debtToEquity);
  let revenue = yRaw(fd?.totalRevenue);   // TTM
  let revenueYoY = typeof yRaw(fd?.revenueGrowth) === 'number' ? round2(yRaw(fd.revenueGrowth) * 100) : null;
  if(qtrMode && qtr.length >= 5){
    const q0 = qtr[qtr.length - 1], q4 = qtr[qtr.length - 5];
    if(q4.v > 0) revenueYoY = round2((q0.v - q4.v) / q4.v * 100);
  }else if(!qtrMode && ann.length >= 2){
    revenue = last.v;
    const prev = ann[ann.length - 2];
    if(prev.v > 0) revenueYoY = round2((last.v - prev.v) / prev.v * 100);
  }
  // История отчётности: ряд выручки (oldest→newest) для спарклайна в карточке.
  const serSrc = (qtrMode ? qtr : ann) || [];
  const revSeries = serSrc.slice(-(qtrMode ? 8 : 6)).map(x => ({ d: String(x.date || '').slice(0, qtrMode ? 7 : 4), v: x.v }));
  revSeries.forEach((x, i) => { const p = revSeries[i - (qtrMode ? 4 : 1)]; x.yoy = (p && p.v > 0) ? round2((x.v / p.v - 1) * 100) : null; });
  return {
    period: qtrMode ? 'quarter' : 'annual',
    source: 'yahoo',
    revSeries,
    ccy: fd?.financialCurrency || null,
    asOf: (qtrMode ? qtr[qtr.length - 1]?.date : last?.date) || null,
    totalDebt: yRaw(fd?.totalDebt),
    totalEquity: null,
    cash: yRaw(fd?.totalCash),
    currentRatio: yRaw(fd?.currentRatio),
    debtToEquity: de == null ? null : round2(de / 100),   // Yahoo reports D/E as a percentage
    operatingCashFlow: yRaw(fd?.operatingCashflow),       // TTM
    freeCashFlow: yRaw(fd?.freeCashflow),                 // TTM
    revenue,
    netIncome: null,
    revenueCagr: cagr === null ? null : round2(cagr),
    revenueYears: years > 0 ? years : null,
    revenueYoY,
  };
}
// Same shape as the FMP earningsInfo() result (revenue actual/estimate for the
// last quarter aren't exposed by Yahoo — those stay null).
async function yahooEarnings(sym){
  const qs = await yQuoteSummary(sym, 'calendarEvents,earningsHistory');
  if(!qs) return null;
  const ev = qs.calendarEvents && qs.calendarEvents.earnings;
  const nextDate = ev?.earningsDate?.[0]?.fmt || null;
  const hist = (qs.earningsHistory && qs.earningsHistory.history) || [];
  const lastH = hist.find(h => h.period === '-1q') || hist[hist.length - 1];
  const next = nextDate ? { date: nextDate, epsEst: yRaw(ev.earningsAverage), revEst: yRaw(ev.revenueAverage) } : null;
  const last = lastH ? { date: lastH.quarter?.fmt || null, epsActual: yRaw(lastH.epsActual), epsEst: yRaw(lastH.epsEstimate), revActual: null, revEst: null } : null;
  return (next || last) ? { next, last, ccy: lastH?.currency || null, source: 'yahoo' } : null;
}

// Next earnings date + dividend info for one symbol (Yahoo calendarEvents/summaryDetail).
// Powers the Портфель 3.0 «Дивиденды и отчёты» sub-tab; dividendRate is annual per share
// in the trading currency.
async function calendarInfo(sym){
  const qs = await yQuoteSummary(sym, 'calendarEvents,summaryDetail');
  if(!qs) return null;
  const ev = qs.calendarEvents || {};
  const sd = qs.summaryDetail || {};
  const e = ev.earnings || {};
  return {
    earnings: e.earningsDate?.[0]?.fmt || null,
    exDiv: ev.exDividendDate?.fmt || null,
    payDate: ev.dividendDate?.fmt || null,
    divRate: yRaw(sd.dividendRate) ?? yRaw(sd.trailingAnnualDividendRate),
    divYield: yRaw(sd.dividendYield),
  };
}

// ── Pre/post-market цена (Yahoo quoteSummary price): для карточки акции, лайв ──
// marketState: PRE/PREPRE · REGULAR · POST/POSTPOST · CLOSED. changePercent в .raw
// приходит долей (0.012 = 1.2%) → ×100. Для не-US пре/пост обычно нет → null.
async function prePost(sym){
  const qs = await yQuoteSummary(sym, 'price');
  const p = qs && qs.price;
  if(!p) return null;
  const pr = v => { const n = yRaw(v); return (typeof n === 'number' && n > 0) ? round2(n) : null; };
  const pct = v => { const n = yRaw(v); return (typeof n === 'number') ? round2(n * 100) : null; };
  const pre = pr(p.preMarketPrice), post = pr(p.postMarketPrice);
  return {
    state: p.marketState || null,
    ccy: p.currency || null,
    regular: pr(p.regularMarketPrice),
    pre: pre != null ? { price: pre, pct: pct(p.preMarketChangePercent) } : null,
    post: post != null ? { price: post, pct: pct(p.postMarketChangePercent) } : null,
  };
}

// ── Fundamental health snapshot (FMP): balance sheet, cash flow, revenue growth ──
// Powers the Портфель 3.0 «Здоровье бизнеса» cards. All fields null when unavailable.
// period 'annual' (default): latest fiscal-year report.
// period 'quarter': balance = latest quarterly snapshot, cash flow = TTM (sum of
// the last 4 quarters), revenue = TTM, YoY = latest quarter vs the same quarter a
// year ago. Revenue CAGR always comes from annual statements.
async function fundamentals(sym, env, period){
  const get = async (path) => {
    try{
      const r = await fetch(`https://financialmodelingprep.com/stable/${path}&apikey=${env.FMP_KEY}`);
      if(!r.ok) return null;
      const j = await r.json();
      return Array.isArray(j) ? j : null;
    }catch(e){ return null; }
  };
  const s = encodeURIComponent(sym);
  const qtr = period === 'quarter';
  const per = qtr ? '&period=quarter' : '';
  const [bs, cf, inc, incA] = await Promise.all([
    get(`balance-sheet-statement?symbol=${s}&limit=1${per}`),
    get(`cash-flow-statement?symbol=${s}&limit=${qtr ? 4 : 1}${per}`),
    get(`income-statement?symbol=${s}&limit=${qtr ? 8 : 6}${per}`),   // annual: до 6 лет · quarter: q0..q7 (YoY + спарклайн истории)
    qtr ? get(`income-statement?symbol=${s}&limit=6`) : null,         // CAGR is always computed on annual data
  ]);
  const b = (bs && bs[0]) || null;
  // Cash flow: single fiscal year, or the TTM sum of up to 4 quarters.
  const cfRows = cf || [];
  const cfSum = (k, alt) => {
    let sum = 0, n = 0;
    for(const r of cfRows){ const v = r[k] ?? (alt ? r[alt] : undefined); if(typeof v === 'number'){ sum += v; n++; } }
    return n ? sum : null;
  };
  // Revenue growth: CAGR over annual history; YoY year-over-year (annual) or quarter-over-year-ago-quarter.
  const ann = (qtr ? incA : inc) || [];   // newest first
  const revNow = ann[0]?.revenue, revOld = ann[ann.length - 1]?.revenue;
  const years = ann.length - 1;
  const cagr = (revNow > 0 && revOld > 0 && years > 0) ? (Math.pow(revNow / revOld, 1 / years) - 1) * 100 : null;
  const qs = (qtr ? inc : null) || [];
  let revenue, revenueYoY;
  if(qtr){
    const ttm = qs.slice(0, 4).reduce((a, r) => a + (typeof r.revenue === 'number' ? r.revenue : 0), 0);
    revenue = ttm > 0 ? ttm : null;
    revenueYoY = (qs.length >= 5 && qs[4].revenue > 0) ? round2((qs[0].revenue - qs[4].revenue) / qs[4].revenue * 100) : null;
  }else{
    revenue = revNow ?? null;
    revenueYoY = (ann.length >= 2 && ann[1].revenue > 0) ? round2((ann[0].revenue - ann[1].revenue) / ann[1].revenue * 100) : null;
  }
  // FMP has no data for most EU/Nordic tickers — fall back to Yahoo.
  if(!b && !cfRows.length && !ann.length && !qs.length){
    const y = await yahooFundamentals(sym, period);
    if(y) return y;
  }
  // История отчётности: ряд выручки (oldest→newest) для спарклайна в карточке.
  const histSrc = (qtr ? qs : ann) || [];
  const revSeries = histSrc.slice(0, qtr ? 8 : 6).reverse()
    .map(x => ({ d: String(x.date || x.calendarYear || '').slice(0, qtr ? 7 : 4), v: (typeof x.revenue === 'number' ? x.revenue : null) }))
    .filter(x => x.v != null);
  revSeries.forEach((x, i) => { const p = revSeries[i - (qtr ? 4 : 1)]; x.yoy = (p && p.v > 0) ? round2((x.v / p.v - 1) * 100) : null; });
  return {
    period: qtr ? 'quarter' : 'annual',
    source: 'fmp',
    revSeries,
    ccy: b?.reportedCurrency || cfRows[0]?.reportedCurrency || ann[0]?.reportedCurrency || 'USD',
    asOf: b?.date || cfRows[0]?.date || null,
    totalDebt: b?.totalDebt ?? null,
    totalEquity: b?.totalStockholdersEquity ?? null,
    cash: b?.cashAndShortTermInvestments ?? b?.cashAndCashEquivalents ?? null,
    currentRatio: (b && b.totalCurrentAssets > 0 && b.totalCurrentLiabilities > 0) ? round2(b.totalCurrentAssets / b.totalCurrentLiabilities) : null,
    debtToEquity: (b && b.totalStockholdersEquity > 0) ? round2((b.totalDebt || 0) / b.totalStockholdersEquity) : null,
    operatingCashFlow: cfSum('operatingCashFlow', 'netCashProvidedByOperatingActivities'),
    freeCashFlow: cfSum('freeCashFlow'),
    revenue,
    netIncome: ann[0]?.netIncome ?? null,
    revenueCagr: cagr === null ? null : round2(cagr),
    revenueYears: years > 0 ? years : null,
    revenueYoY,
  };
}

// ── Earnings calendar (FMP): next report date + market expectations ────────
// Returns { next:{date, epsEst, revEst}, last:{date, epsActual, epsEst, revActual, revEst} }.
// `next` is the nearest upcoming report (consensus estimates), `last` the most
// recent reported quarter (actual vs estimate). Either can be null.
async function earningsInfo(sym, env){
  let out = null;
  try{
    const r = await fetch(`https://financialmodelingprep.com/stable/earnings?symbol=${encodeURIComponent(sym)}&limit=12&apikey=${env.FMP_KEY}`);
    const arr = r.ok ? await r.json() : null;
    if(Array.isArray(arr)){
      const today = new Date().toISOString().slice(0, 10);
      const future = arr.filter(e => e.date && e.date >= today).sort((a, b) => a.date < b.date ? -1 : 1);
      const past = arr.filter(e => e.date && e.date < today && (e.epsActual != null || e.revenueActual != null)).sort((a, b) => a.date > b.date ? -1 : 1);
      const nx = future[0] || null, pv = past[0] || null;
      out = {
        next: nx ? { date: nx.date, epsEst: nx.epsEstimated ?? null, revEst: nx.revenueEstimated ?? null } : null,
        last: pv ? { date: pv.date, epsActual: pv.epsActual ?? null, epsEst: pv.epsEstimated ?? null, revActual: pv.revenueActual ?? null, revEst: pv.revenueEstimated ?? null } : null,
        ccy: 'USD', source: 'fmp',
      };
      if(!out.next && !out.last) out = null;   // FMP knows nothing about this ticker
    }
  }catch(e){ out = null; }
  return out || await yahooEarnings(sym);   // EU/Nordic tickers → Yahoo calendar
}

// ── Авторизация AI-эндпоинтов: пускаем только администратора дашборда ──────
// Клиент шлёт Supabase access-token (Authorization: Bearer …); worker проверяет
// его через /auth/v1/user и роль — по email-списку или по user_access.role.
const ADMIN_EMAILS = ['dmitriy.bilokon@gmail.com', 'dmitriy.bilokon@justforthewin.com'];
async function requireAdmin(request, env){
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if(!token) return { ok:false, error:'Требуется вход на сайт (нет токена)' };
  try{
    const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` } });
    if(!r.ok) return { ok:false, error:'Сессия недействительна — войдите заново' };
    const u = await r.json();
    const email = String(u.email || '').toLowerCase();
    if(ADMIN_EMAILS.includes(email)) return { ok:true, email, uid: u.id };
    const q = await fetch(`${env.SUPABASE_URL}/rest/v1/user_access?user_id=eq.${u.id}&select=role`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
    const rows = q.ok ? await q.json() : [];
    if(rows[0] && rows[0].role === 'admin') return { ok:true, email, uid: u.id };
    return { ok:false, error:'AI Proto доступен только администратору' };
  }catch(e){ return { ok:false, error:'Не удалось проверить доступ' }; }
}

// ── Фоновый AI: результат пишется в таблицу ai_jobs, клиент её опрашивает ──
// (см. supabase-ai-jobs.sql). Воркер пишет service-ролью (обходит RLS); клиент
// читает только свои строки. Долгие прогоны (3–5 мин) больше не держат соединение.
async function aiJobWrite(env, uid, jobId, kind, key, status, result, error){
  try{
    await fetch(`${env.SUPABASE_URL}/rest/v1/ai_jobs`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ job_id: jobId, user_id: uid, kind, key: key || '', status, result: result || null, error: error || null, updated_at: new Date().toISOString() }),
    });
  }catch(e){ /* таблицы ещё нет — клиент покажет таймаут опроса */ }
}
// Запустить работу в фоне (ctx.waitUntil) и отметить результат в ai_jobs.
function aiJobStart(ctx, env, uid, jobId, kind, key, workFn){
  ctx.waitUntil((async () => {
    try{ const out = await workFn(); await aiJobWrite(env, uid, jobId, kind, key, 'done', out, null); }
    catch(e){ await aiJobWrite(env, uid, jobId, kind, key, 'error', null, String((e && e.message) || e)); }
  })());
}

// ── AI Assistant: portfolio analysis via the Claude API ─────────────────────
// The dashboard POSTs a portfolio snapshot (positions with live prices, SMA
// levels, support/resistance, analyst targets, cash/leverage); Claude returns a
// structured markdown report with sell/add/new-position recommendations.
const AI_SYSTEM = `Ты — AI Proto, главная и самая важная аналитическая модель этого инвестиционного дашборда. Ты — постоянно обучающийся портфельный управляющий частного инвестора из Швеции (базовая валюта — шведская крона, kr). Все прочие AI-функции дашборда вспомогательны; именно ты отвечаешь за стратегию портфеля.

ТВОЯ ГЛАВНАЯ ЗАДАЧА — добиться, чтобы портфель ОПЕРЕЖАЛ ВСЕ эталонные индексы (OMXS30, Nasdaq 100, S&P 500) и МАКСИМИЗИРОВАЛ рост капитала на горизонте недель и месяцев. Просто повторить индекс недостаточно: агрессивно ищи альфу — точки входа у уровней, фиксацию перегретых позиций, перевес сильных секторов, моментум-лидеров и недооценённые качественные бумаги с асимметричным потенциалом. Риск-менеджмент — инструмент устойчивого роста, а не потолок амбиций: на идеях высокой убеждённости действуй решительно. Ты работаешь АВТОНОМНО — никаких пользовательских ограничений на твои советы нет; решения принимаешь сам по плейбуку и фактам.

ДАННЫЕ. Тебе передают САМЫЙ СВЕЖИЙ снапшот портфеля и рынка, собранный дашбордом: живые цены, дневные изменения, технические уровни (SMA 50/100/200, поддержка, сопротивление), консенсус-таргеты аналитиков (и свежий срез), мультипликаторы, доли позиций, свободный кэш и кредитное плечо. У каждой позиции может быть betyg — фундамент-рейтинг бумаги (score100 0–100 + буква A–F): используй его как быстрый срез КАЧЕСТВА бизнеса (высокий betyg оправдывает удержание/добор и премию; низкий — повод для осторожности и кандидат на ротацию в более качественную идею). Опирайся на эти переданные данные и свои знания о компаниях; цифры портфеля бери из снапшота, не выдумывай.

ЖИВЫЕ НОВОСТИ И МАКРО. ОБЯЗАТЕЛЬНО используй web_search, чтобы собрать самые свежие данные: новости по ключевым позициям портфеля и кандидатам на новые покупки (отчёты, гайденс, сделки M&A, рейтинги и таргеты аналитиков, регуляторика) и глобальную макрокартину (ставки ФРС/ЕЦБ/Riksbank, инфляция, геополитика, цены на сырьё и валюты, настроение по секторам и ведущим индексам). Учитывай найденное во всех разделах и рекомендациях; кратко ссылайся на самое важное. БЮДЖЕТ РЕСЁРЧА ОГРАНИЧЕН (~90 секунд): делай НЕСКОЛЬКО точечных запросов по самому важному (ключевые позиции, кандидаты, главный макро-драйвер), НЕ дублируй и не уходи в бесконечный поиск — затем ОБЯЗАТЕЛЬНО сведи найденное в выводы. Лучше меньше запросов и чёткое резюме, чем много поисков.

ЖИВЫЕ ЗАГОЛОВКИ ПО ПОЗИЦИЯМ (liveNews). Если в снапшоте есть liveNews — это СВЕЖИЕ заголовки Yahoo по твоим бумагам с тональностью (sent: >0 позитив, <0 негатив) и возрастом (ageDays). ОБЯЗАТЕЛЬНО учитывай их В ПЕРВУЮ ОЧЕРЕДЬ как самую актуальную картину: если по бумаге свежий негатив/даунгрейды/риск-ивент (sent<0, негативные заголовки за последние дни) — это ПЕРЕВЕШИВАЕТ устаревшие таргеты и старый тезис; не рекомендуй докупку под падающий негативный новостной фон.

⚠️ ЛОВУШКА УСТАРЕВШЕГО ТАРГЕТА (КРИТИЧНО). Большой «потенциал к таргету» (upside) сам по себе НЕ означает недооценку. Если у бумаги большой апсайд, НО цена в явном даунтренде (ниже SMA 50/200), недавно резко падала, или liveNews показывает свежий негатив/даунгрейды — таргеты аналитиков, скорее всего, ЕЩЁ НЕ СРЕЗАЛИ под обвалившуюся цену, и «дисконт» фиктивный (классическая value-trap). В таком случае: НЕ преподноси это как недооценку/возможность докупки; проверь web_search свежие пересмотры таргетов и события; по умолчанию относись к такой бумаге как к падающему ножу (наблюдение/держать, вход — только малым траншем после стабилизации и с явной причиной). Доверяй СВЕЖИМ данным (цена, liveNews, web_search) выше старого таргета.

КОММЕНТАРИИ ИЗ ЧАТА. Если в снапшоте есть непустое поле chatNotes — это последние сообщения переписки инвестора с тобой в чате (role: user/assistant, newest в конце). Инвестор намеренно включил их в этот анализ: ОБЯЗАТЕЛЬНО учти высказанные там пожелания, идеи, вопросы и ограничения по конкретным бумагам и стратегии; где уместно — отрази их в рекомендациях и плане, и прямо отметь, как ты их учёл. Если chatNotes пуст или отсутствует — игнорируй этот пункт.

СВОДКА НОВОСТЕЙ ОТ ПОЛЬЗОВАТЕЛЯ. Если в снапшоте есть непустое поле userNews — это сводка последних новостей, которую вставил пользователь. ОБЯЗАТЕЛЬНО разбери её: по каждой затронутой позиции/кандидату оцени направление влияния (позитив/негатив/нейтрально) и кратко обоснуй; учитывай это во всех рекомендациях наравне с web_search. Если userNews пуст или отсутствует — игнорируй этот пункт.

СОВЕРШЁННЫЕ СДЕЛКИ (учитывай ОБЯЗАТЕЛЬНО, ПЕРЕД любыми советами). В снапшоте есть recentTrades — журнал реально исполненных сделок по этому портфелю (newest-first: дата, действие buy/sell, тикер, кол-во, цена, валюта, plSEK — реализованный P/L по продаже), и realizedPLSEK — суммарный реализованный результат. Это уже сделанные действия инвестора. Правила: (1) НЕ предлагай то, что уже исполнено (например «купить X», если X недавно куплен — лучше оцени докупку/удержание/фиксацию относительно средней); (2) НЕ предлагай обратное недавней сделке без явной новой причины (только что продал X → не советуй сразу выкупать обратно, и наоборот) — если основание есть, прямо его назови; (3) учитывай реализованный P/L и недавнюю активность как контекст обучения: что сработало, что нет; (4) сверяй текущие позиции и среднюю цену с историей покупок. Если журнал пуст — просто отметь это и работай по позициям.

ДВИЖЕНИЕ ФЬЮЧЕРСОВ, СТАВКИ И ДОЛЛАР. В снапшоте есть liveMarkets — живые фьючерсы и индексы с дневным изменением %: US-фьючерсы (ES/NQ/YM/RTY) и VIX/сырьё идут почти круглосуточно и показывают направление риска ПРЯМО СЕЙЧАС (в т.ч. пре-маркет США), спот-индексы (OMXS30/DAX/Euro Stoxx/Nikkei) — настроение своих рынков. Также есть доходности US-облигаций (US 10Y yield, US 13w T-bill — прокси ожиданий по ставке ФРС) и индекс доллара (US Dollar idx): это ПРЯМОЙ канал реакции рынка на FED. Сильное движение фьючерсов или скачок VIX учитывай как текущий риск-фон для тайминга докупок/фиксаций.

ЗАСЕДАНИЕ FED / ЦЕНТРОБАНКОВ (учитывай ОБЯЗАТЕЛЬНО, если оно было недавно или предстоит на этой неделе). Через web_search установи: решение по ставке (повышение/снижение/пауза vs ожидания рынка), гайденс/dot-plot и тон Пауэлла (ястребиный/голубиный), реакцию рынка облигаций (10Y yield), доллара и секторов. Разведи влияние по профилю бумаг портфеля: рост/длинная дюрация и высокий P/E (технологии, неприбыльный рост) — чувствительны к росту доходностей; банки/страхование, дивидендные и REIT — к траектории ставок особенно; экспортёры и не-USD позиции — к курсу доллара. В разделах «Докупить»/«Сократить»/«Риски»/«План действий» прямо отрази, как итог заседания смещает тайминг и приоритеты. Не выдумывай исход — бери его из web_search/liveMarkets; если данных нет, так и скажи.

СОГЛАСОВАННОСТЬ С ВЕРДИКТОМ САЙТА (важно). В снапшоте есть recoVerdicts (легенда — recoLegend): детерминированный вердикт скоринга сайта по каждому тикеру (buy/wait/sell/avoid). Это ровно тот вердикт «Рекомендация», который инвестор видит в карточке акции и в таблицах вкладок, и он КРАТКОСРОЧНО-ТЕХНИЧЕСКИЙ (точка входа в моменте: близость к сопротивлению/поддержке, перегрев, тренд). Твои рекомендации НЕ должны выглядеть как немотивированное противоречие этому вердикту. Правило: если ты советуешь ДОКУПИТЬ или ОТКРЫТЬ позицию по бумаге, у которой recoVerdict = sell или avoid (либо СОКРАТИТЬ при verdict = buy), ты ОБЯЗАН явно это оговорить и развести по горизонтам — например: «краткосрочно техника против (у сопротивления / перегрев), но стратегически добираю на горизонте 6–12м из-за <дисконт к NAV / недооценка / диверсификация / снижение USD-риска> → брать не по рынку, а лимит-ордером от уровня X». Если веского стратегического основания перебить технику нет — согласуйся с вердиктом сайта. В details каждой рекомендации в proposal, идущей против вердикта, коротко укажи это расхождение и горизонт.

ПРОТО-СИГНАЛ БЭКТЕСТА (protoSignals, проверен на истории). Если в снапшоте есть protoSignals (легенда — protoLegend) — это ДЕТЕРМИНИРОВАННЫЙ rule-based сигнал по бумаге (SMA/RSI/ATR/уровни), проверенный на 2-летней истории, с полем h = hit-rate на отложенной выборке. И ruleAccuracy — реализованная точность каждого правила по журналу. В отличие от recoVerdict (одномоментный скоринг), это сигнал С ИЗМЕРЕННОЙ исторической надёжностью. Используй как ВЕС доверия к технике: высокий h (≥55%) и положительный s подтверждают лонг; высокий h и отрицательный s — повод для осторожности/фиксации; низкий h (<45%) — сигналу веры мало, опирайся на фундаментал/новости. Не приказ — взвешивай вместе с recoVerdict, оценкой и новостями; при расхождении protoSignal и recoVerdict кратко поясни, чему поверил и почему.

АВТОНОМИЯ И ОБУЧЕНИЕ. Личные правила инвестора ОТМЕНЕНЫ и тебе НЕ передаются (investorRules пуст) — ты не связан ничьими ограничениями и оптимизируешь портфель свободно ради максимального опережения индексов и роста капитала. Учись на результатах: сверяй текущую картину с прежними решениями и трек-рекордом; если прошлая логика не сработала — скорректируй подход и прямо скажи об этом.

ПЛЕЙБУК, ТРЕК-РЕКОРД И БЕНЧМАРК (используй активно). В снапшоте могут быть: playbook — методичка инвестора «как обгонять индекс» (стратегические принципы: качество+моментум, дисциплина входа и оценки, сайзинг, риск, не резать победителей и т.д.) — применяй её как рамку всех решений, она приоритетнее общих эвристик. trackRecord — твой трек-рекорд прошлых разборов: сбывались ли вердикты по направлению цены (точность по типам buy/wait/sell/avoid, средняя доходность) И АЛЬФА к индексу (avgAlphaPct/overallAlphaHitRate — доходность бумаги МИНУС её бенчмарк ^NDX/^OMX за тот же период; именно альфа = реально ли советы обгоняли индекс). УЧИСЬ на нём — усиливай то, что давало положительную альфу, и честно пересматривай подходы с низкой точностью/отрицательной альфой; заметил систематическую ошибку (например, рано фиксируешь рост) — скорректируй и скажи об этом. benchmarks — состав эталонных индексов по секторам (доля по числу бумаг): используй, чтобы КОНКРЕТНО показать перевес/недовес портфеля относительно индекса и какой сдвиг даст опережение. Кратко ссылайся на эти источники в разделе «Обгон индексов».

ГИБКОСТЬ И ПОБЕДИТЕЛИ (важный принцип). НЕ рекомендуй продавать или сокращать сильные, прибыльные, растущие позиции ТОЛЬКО ради диверсификации или «ровных долей» — давай победителям расти (let winners run). Сокращать сильную бумагу можно лишь при объективной причине: явный перегрев/растянутость по технике, цена заметно выше таргета, ухудшение фундаментала или негативный катализатор, либо риск концентрации стал реально опасным (одна позиция настолько доминирует, что угрожает всему портфелю). Недовес секторов/гео закрывай В ПЕРВУЮ ОЧЕРЕДЬ свободным кэшем и НОВЫМИ позициями, а не продажей того, что работает. Диверсификация — инструмент снижения риска, а не самоцель. Сначала ищи ДРУГИЕ рычаги оптимизации: докупка у уровней, ротация из слабых/застойных/проигрывающих бумаг в более сильные идеи, фиксация действительно перегретых, разумное использование кэша и (для Dima) плеча. Сильные позиции трогай в последнюю очередь и только с веским, явно названным обоснованием.

МОМЕНТУМ И ТРЕНД-ПРОДОЛЖЕНИЕ (КРИТИЧНЫЙ УРОК — не упускай прибыль победителей). Систематическая ошибка, которую нужно исправить: ранняя фиксация сильной растущей бумаги и излишняя осторожность на входе РЕАЛЬНО оборачивались упущенной прибылью — победитель продолжал расти после сигнала «продать/сократить», а качественная бумага уезжала вверх, пока ждали отката. Правило: бумагу в подтверждённом восходящем тренде (цена выше SMA50/200, растущий моментум, тезис цел, сектор в фазе роста — напр. цикл памяти/HBM) НЕ советуй продавать или сокращать ТОЛЬКО из-за «перегрева», растянутости над SMA или близости к сопротивлению/таргету: в моментум-режиме сопротивление и консенсус-таргет регулярно пробиваются, а аналитики потом поднимают таргеты вслед за ценой — поэтому большой «пройденный путь» сам по себе НЕ повод выходить. Чтобы резать победителя, нужна КОНКРЕТНАЯ деградация: слом восходящего тренда (уход под SMA50/200, серия нижних максимумов), негативный катализатор или ухудшение фундаментала, импульс явно выдыхается у растянутых уровней, либо реально опасная концентрация. Отличай «растянута в здоровом моментуме» (держать / дать расти / при желании трейлить ЧАСТЬ, а не выходить целиком) от «перегрета и уже разворачивается» (фиксировать). СИММЕТРИЧНО на входе: качественную бумагу в сильном тренде с катализатором не упускай в ожидании глубокого отката, который может не прийти — оправдан моментум-вход или частичный вход сейчас с планом добора на откатах. Это зеркало правила про устаревший таргет: доверяй ТРЕНДУ в обе стороны — не лови падающий нож против нисходящего тренда и не режь/не пропускай победителя против восходящего. Если идёшь против recoVerdict=sell по такой моментум-бумаге — прямо оговори: «техника reco=sell (перегрев), но тренд и тезис целы → держу / дать расти».

Дай структурированный анализ на русском языке в markdown строго по разделам:

## 📊 Ситуация в портфеле и на рынке
2–4 предложения: общее состояние (тренды позиций относительно SMA, концентрация, доля кэша) и где портфель сейчас относительно эталонных индексов.

## 🔴 Продать или сократить
Конкретные позиции с обоснованием ПО ОБЪЕКТИВНОЙ ПРИЧИНЕ (цена у сопротивления, цена выше таргета, перегрев, слабый/ломающийся тренд, ухудшение фундаментала, опасная концентрация). НЕ предлагай продавать прибыльные/сильные бумаги только ради диверсификации или выравнивания долей — для перекосов используй кэш и новые позиции. Если кандидатов на продажу нет — так и скажи одной строкой (это нормально).

## 🟢 Докупить
Какие позиции, на каких уровнях (используй переданные SMA/поддержку), какими частями от свободного кэша. Здесь же — усиление недовесов: предпочитай докупку/новые идеи продаже работающих позиций.

## ➕ Новые позиции
2–4 конкретные идеи (компания, тикер, биржа, почему, какую долю выделить) с учётом недостающих секторов и географии портфеля и того, что даст преимущество над индексами. Это основной способ закрыть недовес — без продажи сильных бумаг.

## 🆚 Обгон индексов
Чётко: чего портфелю не хватает относительно OMXS30 / Nasdaq 100 / S&P 500 (перевес/недовес секторов, гео, факторов) и как предложенные изменения должны дать опережение. Назови главный источник альфы на ближайший период.

## ⚠️ Риски
Главные 2–3 риска текущего портфеля.

## ✅ План действий
Нумерованный список конкретных шагов на ближайшие 2–4 недели с суммами в kr.

Правила: опирайся на переданные данные и свои знания о компаниях; называй конкретные цифры (уровни входа, доли, суммы); будь лаконичен — без воды; если есть marketContext — это живая статистика рыночных фаз по всем индексным вкладкам (Nasdaq 100, S&P 500, OMXS30, OMXSPI, DAX 40, CAC 40, FTSE MIB, OBX 25) и сводки их последних AI-обзоров: используй её как картину рынка (breadth, моментум); в конце отчёта одна строка: «Это аналитическая сводка, а не индивидуальная инвестиционная рекомендация.»

ПОСЛЕДОВАТЕЛЬНОСТЬ С ПРОШЛЫМ АНАЛИЗОМ (changedSince). Если в снапшоте/контексте есть прежние твои выводы (trackRecord, lastAiReview, recentTrades) — НЕ противоречь им без причины. Если ты ИЗМЕНИЛ мнение по бумаге относительно прошлого раза (поднял/снял приоритет, развернул совет) — кратко объясни ЧТО и ПОЧЕМУ изменилось в поле changedSince. Если это первый анализ или существенных изменений нет — оставь changedSince пустой строкой.

ЛИСТ ОЖИДАНИЯ (watchlist). Кроме готовых действий, добавь 0–4 идеи «на подтверждении» в watchlist: бумаги, которые интересны, но входить ПОКА рано — с условием входа (condition) и причиной (rationale). Это приоритет 4 (наблюдение), не немедленная сделка.

В САМОМ КОНЦЕ ответа добавь машиночитаемый план ребалансировки (он отображается на вкладке «Предложение») — fenced json, открой и закрой его символами ${FENCE} :
${FENCE}json
{"summary":"<2–3 предложения о целевой структуре, нацеленной на обгон индексов>","changedSince":"<что изменилось с прошлого анализа и почему; пусто, если первый анализ или без изменений>","actions":[{"action":"Купить|Докупить|Сократить|Продать|Держать","name":"<компания>","ticker":"<тикер>","details":"<уровень входа/выхода и краткое обоснование>","amountSEK":<число или null>}],"watchlist":[{"name":"<компания>","ticker":"<тикер>","condition":"<при каком условии входить>","rationale":"<почему интересна>"}]}
${FENCE}`;

// Structured output: report (markdown) + machine-readable rebalancing proposal
// for the dashboard's «Предложение» sub-tab.
const AI_SCHEMA = {
  type: 'object',
  properties: {
    report: { type: 'string', description: 'Полный анализ в markdown по заданным разделам' },
    proposal: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '2–3 предложения о целевой структуре портфеля' },
        changedSince: { type: 'string', description: 'Что изменилось с прошлого анализа и почему; пусто, если первый анализ или без изменений' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['Купить', 'Докупить', 'Сократить', 'Продать', 'Держать'] },
              name: { type: 'string' },
              ticker: { type: 'string' },
              details: { type: 'string' },
              amountSEK: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            },
            required: ['action', 'name', 'ticker', 'details', 'amountSEK'],
            additionalProperties: false,
          },
        },
        watchlist: {
          type: 'array',
          description: 'Идеи «на подтверждении» — приоритет 4, не немедленная сделка',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              ticker: { type: 'string' },
              condition: { type: 'string', description: 'Условие входа' },
              rationale: { type: 'string' },
            },
            required: ['name', 'ticker', 'condition', 'rationale'],
            additionalProperties: false,
          },
        },
      },
      required: ['summary', 'changedSince', 'actions', 'watchlist'],
      additionalProperties: false,
    },
  },
  required: ['report', 'proposal'],
  additionalProperties: false,
};

// Watchlist mode (index tabs): analyze the tab's stocks and surface the most
// relevant ones with concrete actions. Same JSON schema as the portfolio run.
const WATCH_SYSTEM = `Ты — опытный рыночный аналитик. Тебе передают watchlist-снапшот вкладки биржевого индекса (поле index): все акции с живыми ценами, дневными изменениями, SMA 50/100/200, поддержкой/сопротивлением, консенсус-таргетами, P/E и P/S, рыночной фазой (phase: падающий нож, импульс, аптренд…) и сигналом близости к уровню (signal).

Дай анализ на русском языке в markdown строго по разделам:

## 📊 Картина по индексу
2–4 предложения: breadth (сколько в аптренде/даунтренде), общий моментум, что выделяется.

## 🔥 Самые актуальные акции
Выбери 5–8 бумаг, где прямо сейчас происходит главное (цена у ключевого уровня, сильный импульс, перегрев, явная недооценка к таргету, падающий нож). Для каждой: **действие** (Купить / Следить / Фиксировать прибыль / Избегать), уровни входа-выхода из переданных данных и одна строка почему.

## 🏭 Сектора
Какие сектора индекса сильны, какие слабы (по фазам и дневным движениям).

## ⚠️ Риски
2–3 главных риска для этого индекса сейчас.

В снапшоте есть liveMarkets — живые фьючерсы и индексы с дневным изменением % (US-фьючерсы, VIX, сырьё, мировые индексы): направление риска прямо сейчас (в т.ч. пре-маркет США). Учитывай его в общей картине и тайминге.

Правила: опирайся на переданные данные и свои знания о компаниях; конкретные цифры и уровни; лаконично; если есть investorRules — строго учитывай их; в конце одна строка: «Это аналитическая сводка, а не индивидуальная инвестиционная рекомендация.»

Ответ верни строго в JSON по схеме: report — анализ в markdown; proposal — summary (1–2 предложения о состоянии индекса) и actions — те же 5–8 самых актуальных акций (action из списка: Купить/Докупить/Сократить/Продать/Держать — подбери ближайшее по смыслу; details: уровни и причина; amountSEK: null).`;

async function aiAnalyze(env, snapshot){
  const watch = !!(snapshot && snapshot.mode === 'watchlist');
  const system = watch ? WATCH_SYSTEM : AI_SYSTEM;
  const today = new Date().toISOString().slice(0, 10);
  if(snapshot && typeof snapshot === 'object') snapshot.liveMarkets = await liveMarkets().catch(() => []);
  const reqBody = {
    model: aiModel(watch ? 'watchlist' : 'portfolio'),
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: `Сегодня ${today}. Снапшот (JSON):\n${JSON.stringify(snapshot)}` }],
  };
  // Watchlist (индексы) — структурированный вывод. Портфель (AI Proto) — с web_search
  // по свежим новостям/макро, поэтому план ребалансировки приходит fenced-json.
  if(watch) reqBody.output_config = { format: { type: 'json_schema', schema: AI_SCHEMA } };
  else reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];
  const j = await anthropicRun(env, reqBody);   // устойчиво к pause_turn (web_search)
  const cost = aiCost(j);
  const raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join(watch ? '' : '\n');
  if(!raw) throw new Error('Пустой ответ модели');
  if(watch){
    try{ const parsed = JSON.parse(raw); if(parsed && parsed.report) return { text: parsed.report, proposal: parsed.proposal || null, cost }; }catch(e){ /* fall back */ }
    return { text: raw, proposal: null, cost };
  }
  // Портфель: вынуть финальный fenced-json (план ребалансировки) и убрать его из текста отчёта.
  let text = raw, proposal = null;
  const i = raw.lastIndexOf(FENCE + 'json');
  if(i >= 0){
    const rest = raw.slice(i + FENCE.length + 4);
    const end = rest.indexOf(FENCE);
    if(end >= 0){ try{ proposal = JSON.parse(rest.slice(0, end).trim()); }catch(e){} text = raw.slice(0, i).trim(); }
  }
  return { text, proposal, cost };
}

// ── AI chat (Портфель 3.0 «AI Assistant»): multi-turn Q&A over the live
// portfolio snapshot + the investor's saved rules. Returns {reply, memory[]}
// where memory = new durable preferences extracted from the user's message —
// the dashboard appends them to the rules list ("обучение" ассистента).
const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'Ответ ассистента в markdown' },
    memory: { type: 'array', items: { type: 'string' }, description: 'Новые устойчивые правила/предпочтения инвестора из его сообщения (пустой список, если нет)' },
  },
  required: ['reply', 'memory'],
  additionalProperties: false,
};
const CHAT_SYSTEM = `Ты — AI Proto, главная аналитическая модель инвестиционного дашборда частного инвестора из Швеции (базовая валюта — шведская крона, kr). Твоя сверхзадача — помогать всем портфелям ОПЕРЕЖАТЬ ВСЕ эталонные индексы (OMXS30, Nasdaq 100, S&P 500) и МАКСИМИЗИРОВАТЬ прибыль. Ты работаешь АВТОНОМНО: личные правила инвестора отменены и не ограничивают твои советы — решай сам по плейбуку и фактам. В системном контексте тебе передают живой снапшот портфеля (позиции, цены, SMA 50/100/200, поддержка/сопротивление, консенсус-таргеты, кэш и плечо) и recentTrades — журнал уже совершённых сделок (дата/действие/тикер/кол-во/цена/реализованный P/L). Сделки из recentTrades учитывай ПЕРЕД советами: не предлагай уже сделанное и не советуй обратное недавней сделке без явной причины. Если переданы playbook (методичка «как обгонять индекс») и trackRecord (точность прошлых вердиктов) — опирайся на них: применяй принципы плейбука и учись на трек-рекорде.

Отвечай на вопросы инвестора на русском языке, в markdown, кратко и по делу: конкретные цифры, уровни, доли и суммы в kr. Действуй проактивно и решительно — давай чёткие советы. Опирайся на снапшот и свои знания о компаниях; не выдумывай данные, которых нет. Если вопрос про сделку — дай конкретную рекомендацию с обоснованием и уровнями.

Поле memory верни пустым списком (правила инвестора отменены — ничего не накапливаем).`;

async function aiChat(env, body){
  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-20)
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }))
    .filter(m => m.content);
  if(!messages.length) throw new Error('Пустое сообщение');
  const ctx = `Сегодня ${new Date().toISOString().slice(0, 10)}.\n\nПравила инвестора:\n${(body.prefs || []).map(p => '• ' + p).join('\n') || '(пока нет)'}\n\nСнапшот портфеля (JSON):\n${JSON.stringify(body.snapshot || {})}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: aiModel('chat'),
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: CHAT_SCHEMA } },
      system: [{ type: 'text', text: CHAT_SYSTEM, cache_control: { type: 'ephemeral' } }, { type: 'text', text: ctx }],
      messages,
    }),
  });
  if(!r.ok) throw new Error('Claude API ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  const raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  if(!raw) throw new Error('Пустой ответ модели');
  const cost = aiCost(j);
  try{
    const parsed = JSON.parse(raw);
    if(parsed && parsed.reply) return { reply: parsed.reply, memory: Array.isArray(parsed.memory) ? parsed.memory : [], cost };
  }catch(e){ /* schema miss — fall back to raw text */ }
  return { reply: raw, memory: [], cost };
}

// ── 🤖 AI Портфель: виртуальный портфель под управлением Claude ────────────
// Каждый час (гейт intervalMin поверх 10-минутного cron) worker собирает
// снапшот: позиции с живыми котировками, кэш, журнал сделок и вселенную всех
// акций дашборда (цены/SMA/уровни/типы из сохранённых вкладок) — и просит
// Claude принять торговые решения. Исполнение по живым ценам Yahoo, состояние
// в snap.aiPort (Supabase), Telegram-уведомление по каждой сделке.
const AIPORT_SYSTEM = `Ты — AI Proto, главная аналитическая модель этого инвестиционного дашборда, и ты же АВТОНОМНО управляешь собственным ВИРТУАЛЬНЫМ AI-портфелем (paper trading, базовая валюта — шведская крона SEK). Тебе передают JSON: кэш, стартовый капитал, позиции с живыми ценами и P&L, журнал последних сделок, курсы валют и вселенная доступных акций (формат строки — в universeLegend). Это ТВОЙ портфель: ты формируешь его и управляешь им сам.

ЦЕЛЬ ПОРТФЕЛЯ — опережать ВСЕ эталонные индексы (OMXS30, Nasdaq 100, S&P 500) и МАКСИМИЗИРОВАТЬ рост капитала на горизонте месяцев. Просто повторить индекс недостаточно: агрессивно ищи альфу — точки входа у уровней, фиксацию перегретых позиций, перевес сильных секторов, моментум-лидеров и асимметричные идеи. У тебя НЕТ искусственных ограничений: концентрируйся в лучших идеях высокой убеждённости и действуй решительно. Риск-менеджмент — инструмент устойчивого роста, не потолок: избегай лишь явно бессмысленного риска (хайп без тезиса, падающий нож).

Управляй портфелем САМОСТОЯТЕЛЬНО по своей методичке (playbook) и принципам ниже: формируй позиции, докупай у уровней, фиксируй прибыль и убытки, ребалансируй по типам и секторам.

ПЛЕЙБУК (твоя стратегическая рамка). playbook — твоя методичка «как обгонять индекс» (качество+моментум, дисциплина входа/оценки, сайзинг, риск, не резать победителей): применяй её строго, она приоритетнее общих эвристик; каждое решение должно быть с ней согласовано. ВАЖНО: личные правила инвестора и пользовательские промпты-стратегии тебе НЕ передаются — это твой независимый портфель, ты работаешь как AI Proto по плейбуку и фактам, без чьих-либо личных указаний.

ТВОЙ РЕЗУЛЬТАТ vs ИНДЕКСЫ (самооценка). В поле performance — твоя доходность с даты старта (portfolioReturnPct) и сравнение с эталонами (vsIndex: indexReturnPct и alphaPct = твоя доходность минус индекс). Это твоя главная оценка. Если по большинству индексов alphaPct < 0 — ты ОТСТАЁШЬ: критически пересмотри подход (качество отбора, тайминг входов, концентрация, доля кэша, не передерживаешь ли проигравших) и сделай осмысленный шаг к улучшению — но без паники и переторговли. Если обгоняешь (alphaPct > 0) — закрепляй работающее, не ломай его лишними сделками. В performance.history — дневные снимки твоей альфы за прошлые циклы: смотри ТРЕНД (альфа растёт или падает во времени) — если стабильно деградирует, меняй подход решительнее; если растёт, продолжай линию. В note кратко отметь, обгоняешь ты индексы или отстаёшь, куда идёт тренд альфы и что корректируешь.

Правила:
- Торгуй ТОЛЬКО тикерами из universe или из своих позиций.
- Торгуй ТОЛЬКО бумагами, чей рынок сейчас ОТКРЫТ — смотри marketsOpen по валюте бумаги (true = биржа торгует). Решения по закрытым рынкам будут отклонены исполнением.
- qty — целое число акций; сумма сделки ≥ minTradeSEK; не покупай, если не хватает cashSEK.
- ИЗДЕРЖКИ. Каждая сделка облагается комиссией: courtage 0.15% от суммы, но НЕ меньше ~6 единиц местной валюты (USD/EUR/CHF/GBP, 7 CAD), плюс ~0.25% валютная надбавка за конвертацию для бумаг не в SEK (≈0.5% за круг покупка+продажа), плюс налог на покупку для UK (0.5%). Минимум «кусается» на мелких сделках (порог 6 достигается лишь около 4000 в валюте). Поэтому НЕ дроби позиции на мелкие сделки, избегай частой переторговли и меняй портфель только когда ожидаемая выгода уверенно превышает издержки round-trip.
- Размер кэша и концентрацию решаешь САМ по убеждённости — жёстких лимитов на долю позиции и резерв кэша нет. Можешь сильно концентрироваться в лучших идеях; следи лишь, чтобы одна ошибка не уничтожала портфель.
- ПОБЕДИТЕЛЕЙ НЕ РЕЖЬ РАДИ ДИВЕРСИФИКАЦИИ. Сильную прибыльную растущую позицию (если она не пробила лимит ≤15% и нет объективной причины — перегрев/выше таргета/слом тренда/ухудшение фундаментала) НЕ сокращай только ради «ровных долей» или закрытия недовеса. Недовес секторов/типов закрывай в первую очередь кэшем и НОВЫМИ позициями, ротацией из слабых/застойных бумаг — а не продажей того, что работает. Давай победителям расти.
- МОМЕНТУМ — НЕ РЕЖЬ ПОБЕДИТЕЛЯ РАНО (урок: ранняя фиксация и осторожный вход = упущенная прибыль). Сильную позицию в подтверждённом аптренде (выше SMA50/200, растущий моментум, тезис цел) НЕ продавай только из-за перегрева/растянутости/близости к сопротивлению или таргету — в моментум-режиме они пробиваются, таргеты поднимают вслед за ценой. Режь победителя лишь при КОНКРЕТНОЙ деградации: слом тренда (уход под SMA50/200, нижние максимумы), негативный катализатор/ухудшение фундаментала, импульс выдохся, опасная концентрация — иначе держи или трейль ЧАСТЬ, не выходи целиком. Симметрично: качественную бумагу в сильном тренде с катализатором не упускай в ожидании отката, которого может не быть — оправдан моментум-вход или частичный вход с добором на откатах.
- Триггеры: цена у SMA 50/200 или поддержки при здоровом тренде — покупка/докупка; у сопротивления, выше таргета или при перегреве — фиксация; падающий нож без явного сетапа — избегать. Стоп-дисциплину (когда резать убыток) определяешь сам по тезису — фиксированного стопа нет.
- recoVerdict в universe — вердикт детерминированного скоринга сайта (фундаментал+техника+риск): учитывай его как ОДИН ИЗ факторов, не как приказ. Ты можешь действовать против вердикта свободно; если идёшь против — кратко поясни в reason, почему (так понятнее тебе же при разборе результатов).
- protoSignals (легенда — protoLegend) — проверенный на 2-летней истории rule-based прото-сигнал по тикеру с измеренным hit-rate (h). В отличие от recoVerdict, у него есть ИСТОРИЧЕСКАЯ надёжность: высокий h (≥55%) усиливает доверие к знаку сигнала, низкий (<45%) — ослабляет. Есть не по всем тикерам. Используй как вес доверия к технике при выборе входов/фиксаций, не как приказ.
- БОЛЬШИНСТВО циклов не требуют сделок: нет явных сетапов — верни пустой decisions. Не торгуй ради торговли. Жёсткого лимита на число сделок за цикл нет — делай столько, сколько оправдано (но помни про издержки).
- reason: 1–2 предложения с конкретными уровнями и цифрами; trigger: краткое условие («цена коснулась SMA 200», «фиксация +18%», «ребаланс: перевес Роста»).
- note: 1–3 предложения — состояние портфеля и чего ждёшь к следующему циклу.

Ответ строго в JSON по схеме.`;
const AIPORT_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['buy', 'sell'] },
          ticker: { type: 'string' },
          qty: { type: 'number' },
          reason: { type: 'string' },
          trigger: { type: 'string' },
        },
        required: ['action', 'ticker', 'qty', 'reason', 'trigger'],
        additionalProperties: false,
      },
    },
    note: { type: 'string', description: 'Краткий комментарий о состоянии портфеля' },
  },
  required: ['decisions', 'note'],
  additionalProperties: false,
};

// Торговые сессии бирж по валюте инструмента (локальное время биржи, пн–пт).
// Праздники не учитываются (аппроксимация); часы регулярной сессии.
const MARKET_HOURS = {
  USD: { tz: 'America/New_York',  open: 9 * 60 + 30, close: 16 * 60 },
  CAD: { tz: 'America/Toronto',   open: 9 * 60 + 30, close: 16 * 60 },
  SEK: { tz: 'Europe/Stockholm',  open: 9 * 60,      close: 17 * 60 + 25 },
  NOK: { tz: 'Europe/Oslo',       open: 9 * 60,      close: 16 * 60 + 20 },
  DKK: { tz: 'Europe/Copenhagen', open: 9 * 60,      close: 16 * 60 + 55 },
  EUR: { tz: 'Europe/Berlin',     open: 9 * 60,      close: 17 * 60 + 30 },
  GBP: { tz: 'Europe/London',     open: 8 * 60,      close: 16 * 60 + 30 },
};
function marketOpen(ccy, date){
  const m = MARKET_HOURS[String(ccy || '').toUpperCase()] || MARKET_HOURS.USD;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: m.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date || new Date());
  const get = t => (parts.find(p => p.type === t) || {}).value;
  const wd = get('weekday');
  if(wd === 'Sat' || wd === 'Sun') return false;
  const mins = (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10);
  return mins >= m.open && mins < m.close;
}

// Вселенная: все акции v3-вкладок дашборда, компактными массивами (см. legend).
const AIPORT_LEGEND = '[ticker, ccy, sector, type, price, day%, %fromSMA50, %fromSMA200, %fromSupport, %fromResistance, upside%toTarget, P/E, Beta, ROE%, revGrowth%, recoVerdict(buy|wait|sell|avoid|null — детерминированный скоринг сайта)]';
function aipUniverse(snap){
  const out = [], seen = new Set();
  const data = (snap && snap.data) || {};
  for(const key of Object.keys(data)){
    const d = data[key];
    if(!d || d.v3 !== '1' || d.aip === '1' || !Array.isArray(d.rows)) continue;   // aip — производная вкладка самого AI
    const h = d.headers || [];
    const ix = {
      s50: h.findIndex(x => /sma.?50$/i.test(x)), s200: h.findIndex(x => /sma.?200/i.test(x)),
      sup: h.indexOf('Поддержка'), res: h.indexOf('Сопротивление'), tg: h.findIndex(x => /аналит/i.test(x)),
      tgr: h.findIndex(x => /таргет 3м/i.test(x)),
      pe: h.indexOf('P/E'), beta: h.indexOf('Beta'), roe: h.indexOf('ROE'), revg: h.indexOf('Рост выручки'),
      reco: h.indexOf('Реком. скоринг'),
    };
    for(const r of d.rows){
      const tk = String(r[2] || '').trim();
      if(!tk) continue;
      const ccy = String(r[8] || 'USD');
      const sym = exSymbol(tk, ccy);
      if(seen.has(sym)) continue;
      seen.add(sym);
      const price = parseFloat(r[7]) || 0;
      if(!(price > 0)) continue;
      const num = i => { const v = i >= 0 ? parseFloat(r[i]) : NaN; return isFinite(v) ? v : null; };
      const dist = v => (v && v > 0) ? Math.round((price - v) / v * 1000) / 10 : null;
      // Эффективный таргет: устаревший консенсус (расходится со свежим «Таргет 3м»
      // на ≥10%) → берём свежий. Тот же расчёт, что pf3EffTarget на сайте — чтобы
      // upside (и производный перегрев в aipVerdict) не противоречил карточке.
      const tgMain = num(ix.tg), tgRec = num(ix.tgr);
      const tg = (tgMain > 0 && tgRec > 0 && Math.abs(tgRec - tgMain) / tgMain * 100 >= 10) ? tgRec : (tgMain || tgRec);
      out.push([tk, ccy, String(r[4] || ''), String(r[5] || ''), price, parseFloat(r[10]) || 0,
        dist(num(ix.s50)), dist(num(ix.s200)), dist(num(ix.sup)), dist(num(ix.res)),
        (tg && tg > 0) ? Math.round((tg / price - 1) * 1000) / 10 : null,
        num(ix.pe), num(ix.beta), num(ix.roe), num(ix.revg),
        (ix.reco >= 0 && /^(buy|wait|sell|avoid)$/.test(String(r[ix.reco] || ''))) ? String(r[ix.reco]) : null]);
    }
  }
  return out;
}
// 🧪 Раздел 6: слить прото-сигналы бэктеста (data[tab].btSignals, пишет клиент)
// по всем вкладкам в одну карту {ТИКЕР:{s,v,h}}. Есть не по всем тикерам.
function mergeProtoSignals(snap){
  const out = {}, data = (snap && snap.data) || {};
  for(const key of Object.keys(data)){
    const bs = data[key] && data[key].btSignals;
    if(bs && typeof bs === 'object') for(const tk of Object.keys(bs)){ if(!out[tk]) out[tk] = bs[tk]; }
  }
  return out;
}
// Приближённый вердикт по полям вселенной — на случай, когда сохранённая
// колонка «Реком. скоринг» пуста (вкладка давно не обновлялась на сайте).
// Зеркалит pf3Reco по доступным полям; при наличии сохранённого вердикта
// авторитетен сохранённый (он совпадает с интерфейсом).
function aipVerdict(u){
  const type=u[3],day=u[5],d50=u[6],d200=u[7],dSup=u[8],dRes=u[9],up=u[10],pe=u[11],beta=u[12],roe=u[13],revg=u[14];
  let f=0,t=0,r=0;
  if(up!=null){ if(up>=25)f+=2; else if(up>=10)f+=1; else if(up<=-5)f-=1.5; }
  if(roe!=null){ if(roe>=15)f+=1; else if(roe<0)f-=1.5; }
  if(revg!=null){ if(revg>=10)f+=1; else if(revg<0)f-=0.5; }
  if(pe!=null&&pe>0){ if(pe<=15)f+=0.5; else if(pe>=40)f-=1; }
  const belowAll=d50!=null&&d50<0&&d200!=null&&d200<0;
  const aboveAll=d50!=null&&d50>0&&d200!=null&&d200>0;
  let knife=false;
  if(belowAll&&((day!=null&&day<=-3)||(dSup!=null&&dSup<0))){ t-=2.5; knife=true; }
  else if(up!=null&&up<=-5)t-=1.5;
  else if(aboveAll&&d200>=30)t-=1.5;
  else if(aboveAll)t+=1.5;
  else if(belowAll)t-=1.5;
  else t-=0.5;
  const near=v=>v!=null&&Math.abs(v)<=2;
  if(near(d50)||near(d200)||near(dSup))t+=1.5;
  else if(near(dRes))t-=1.5;
  if(type==='Спекулятивная')r-=1.5;
  if(beta!=null&&beta>1.5)r-=0.5;
  if(up==null&&roe==null&&pe==null&&beta==null)return 'wait';   // данных нет — осторожно
  const total=f+t+r;
  if((type==='Спекулятивная'&&t+r<=-2)||(total<=-4.5&&r<0))return 'avoid';
  if(knife)return 'wait';
  if(total<=-2)return 'sell';
  if(total>=2.5&&f>=0.5&&t>=0)return 'buy';
  return 'wait';
}
// Имя/сектор/тип бумаги — из первой вкладки, где она встречается.
function aipFindRow(snap, tk){
  const T = tk.toUpperCase();
  for(const key of Object.keys((snap && snap.data) || {})){
    const d = snap.data[key];
    if(!d || d.v3 !== '1') continue;
    const r = (d.rows || []).find(r => String(r[2] || '').trim().toUpperCase() === T);
    if(r) return r;
  }
  return null;
}

// Полное обнуление AI-портфеля: свежий счёт 300 000 kr, настройки и стратегия
// сохраняются. Чистит основное состояние и ОБА резерва (aiPortBak + ai_state) —
// иначе самовосстановление вернуло бы старые позиции. startedAt обновляется и
// служит маркером: цикл, шедший в момент обнуления, отбросит свои результаты.
async function aiPortfolioReset(env){
  const row = await loadRow(env);
  if(!row) return 'Строка данных не найдена';
  const old = (row.snap && row.snap.aiPort) || {};
  const ap = {
    startedAt: Date.now(), startCapital: 300000, cashSEK: 300000,
    commissionPct: old.commissionPct || 0, minTradeSEK: old.minTradeSEK || 5000,
    intervalMin: old.intervalMin || 60, enabled: old.enabled !== false,
    strategy: old.strategy || '', positions: [], trades: [], equityHistory: [],
    myStartEquity: null, myStartLive: '', lastRunAt: 0, lastNote: '',
  };
  row.snap.aiPort = ap;
  row.snap.aiPortBak = JSON.parse(JSON.stringify(ap));
  await writeRow(env, row.userId, row.snap);
  await saveBak(env, row.userId, ap);
  return 'AI портфель обнулён ✓ Счёт 300 000 kr, настройки сохранены. Нажмите ▶ или ждите следующего тика крона.';
}

// 💸 Комиссия сделки (Avanza «Small»), В ВАЛЮТЕ БУМАГИ: courtage 0.15% но не
// меньше lägsta в местной валюте; + валютная надбавка 0.25% (не-SEK); + налог на
// покупку (UK stamp 0.5% + £1.5 свыше £10k). Та же модель, что на клиенте.
const AIPORT_COURTAGE_MIN = { USD: 6, CAD: 7, EUR: 6, CHF: 6, GBP: 6, SEK: 1 };
function tradeFeeNativeW(ccy, amount, isBuy){
  ccy = String(ccy || 'USD').toUpperCase();
  if(!(amount > 0)) return 0;
  const min = AIPORT_COURTAGE_MIN[ccy] != null ? AIPORT_COURTAGE_MIN[ccy] : 6;
  const courtage = Math.max(amount * 0.15 / 100, min);
  const fxFee = ccy === 'SEK' ? 0 : amount * 0.25 / 100;
  let tax = 0;
  if(isBuy && ccy === 'GBP') tax = amount * 0.5 / 100 + (amount > 10000 ? 1.5 : 0);
  return courtage + fxFee + tax;   // в валюте бумаги
}
// Результат AI-портфеля с начала vs эталонные индексы (для самооценки бота).
// Тянет дневные закрытия ^OMX/^NDX/^GSPC и считает их доходность с даты старта.
async function aipBenchmarks(env, startMs){
  const startDate = new Date(startMs).toISOString().slice(0, 10);
  const out = [];
  await Promise.all([['^OMX', 'OMXS30'], ['^NDX', 'Nasdaq 100'], ['^GSPC', 'S&P 500']].map(async ([sym, name]) => {
    try{
      const h = await dailyHistory(sym, '2y');
      if(!h || !Array.isArray(h.t) || !Array.isArray(h.c)) return;
      let i0 = null;
      for(let i = 0; i < h.t.length; i++){ const d = new Date(h.t[i] * 1000).toISOString().slice(0, 10); if(h.c[i] != null && d >= startDate){ i0 = h.c[i]; break; } }
      let last = null; for(let i = h.c.length - 1; i >= 0; i--){ if(h.c[i] != null){ last = h.c[i]; break; } }
      if(i0 > 0 && last > 0) out.push({ index: name, returnPct: Math.round((last / i0 - 1) * 1000) / 10 });
    }catch(e){}
  }));
  return out;
}
async function aiPortfolioRun(env, force){
  if(!env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY не задан';
  const row = await loadRow(env);
  const snap = row && row.snap;
  let ap = snap && snap.aiPort;
  // ♻️ Самовосстановление: worker хранит собственную копию (aiPortBak) при
  // каждой записи. Если клиент затёр aiPort (старый кеш сайта пушит снапшот
  // без этого ключа / отставшая копия) — восстанавливаем из резерва.
  let restored = false;
  const bak = (await loadBak(env, row && row.userId)) || (snap && snap.aiPortBak);
  if(bak && bak.startedAt){
    const apEmpty = !ap || !ap.startedAt || (!(ap.positions || []).length && !(ap.trades || []).length);
    const bakHas = (bak.positions || []).length || (bak.trades || []).length;
    // Резерв НОВЕЕ (того же/старшего поколения startedAt и больший lastRunAt) → ledger затёрли
    // клиентом; восстанавливаем даже если он не пустой. Сброс (ledger новее по startedAt) не трогаем.
    const bakNewer = bakHas && (bak.startedAt || 0) >= ((ap && ap.startedAt) || 0) && (bak.lastRunAt || 0) > ((ap && ap.lastRunAt) || 0);
    if((apEmpty && bakHas) || bakNewer){
      ap = snap.aiPort = JSON.parse(JSON.stringify(bak));
      restored = true;
      // Персистим восстановление СРАЗУ: дальше цикл может выйти по «рынки
      // закрыты», и без записи восстановление жило бы только в памяти
      // (на выходных портфель оставался бы пустым при спаме «ВОССТАНОВЛЕН»).
      try{
        const fr = await loadRow(env);
        if(fr){
          fr.snap.aiPort = JSON.parse(JSON.stringify(ap));
          fr.snap.aiPortBak = JSON.parse(JSON.stringify(ap));
          await writeRow(env, fr.userId, fr.snap);
        }
        await saveBak(env, row.userId, ap);
        await sendTelegram(env, `♻️ <b>AI ПОРТФЕЛЬ ВОССТАНОВЛЕН</b> из резервной копии worker'а: позиций ${(ap.positions || []).length}, сделок ${(ap.trades || []).length}. Похоже, какой-то клиент затёр состояние — обновите сайт на всех устройствах.`);
      }catch(e){}
    }
  }
  if(!ap || !ap.startedAt) return 'AI портфель не инициализирован — откройте вкладку 🤖 на сайте';
  if(ap.enabled === false) return 'AI портфель выключен в настройках';
  const now = Date.now();
  const iv = (parseFloat(ap.intervalMin) || 60) * 60e3;
  if(!force && !restored && ap.lastRunAt && now - ap.lastRunAt < iv - 90e3) return `Рано: следующий цикл через ${Math.ceil((ap.lastRunAt + iv - now) / 60e3)} мин`;
  const fx = Object.assign({}, FX_DEFAULT, snap.fx || {});
  // Торговые сессии: решения возможны только по открытым рынкам.
  const marketsOpen = {};
  Object.keys(MARKET_HOURS).forEach(c => { marketsOpen[c] = marketOpen(c, new Date(now)); });
  if(!Object.values(marketsOpen).some(Boolean)) return 'Все рынки закрыты (выходной/вне сессии) — торговый цикл пропущен';
  const positions = ap.positions = Array.isArray(ap.positions) ? ap.positions : [];
  // Живые котировки позиций — для P&L, триггеров и исполнения продаж.
  const quotes = {};
  await Promise.all(positions.map(async p => { quotes[p.ticker] = await yahoo(exSymbol(p.ticker, p.ccy)); }));
  const pView = positions.map(p => {
    const q = quotes[p.ticker];
    const price = (q && q.price > 0) ? q.price : (p.lastPrice || p.avgBuy);
    const f = fx[p.ccy] || 1;
    return { ticker: p.ticker, name: p.name, ccy: p.ccy, type: p.type || '', sector: p.sector || '',
      qty: p.qty, avgBuy: p.avgBuy, price, valueSEK: Math.round(p.qty * price * f),
      plPct: p.avgBuy > 0 ? Math.round((price / p.avgBuy - 1) * 1000) / 10 : 0,
      day: (q && typeof q.pct === 'number') ? Math.round(q.pct * 10) / 10 : null,
      sma50: q && q.sma50, sma200: q && q.sma200, support: q && q.support, resistance: q && q.resistance };
  });
  const equity = Math.round((ap.cashSEK || 0) + pView.reduce((a, p) => a + p.valueSEK, 0));
  const payload = {
    today: new Date().toISOString().slice(0, 10),
    startCapitalSEK: ap.startCapital || 300000,
    cashSEK: Math.round(ap.cashSEK || 0),
    equitySEK: equity,
    minTradeSEK: ap.minTradeSEK || 5000,
    commissionPct: ap.commissionPct || 0,
    fx,
    marketsOpen,
    positions: pView,
    recentTrades: (ap.trades || []).slice(-25).map(t => ({ ts: t.ts ? new Date(t.ts).toISOString().slice(0, 16) : '', action: t.action, ticker: t.ticker, qty: t.qty, price: t.price, reason: t.reason })),
    universeLegend: AIPORT_LEGEND,
    universe: aipUniverse(snap),
    playbook: Array.isArray(snap.aiPlaybook) ? snap.aiPlaybook : [],   // 📚 методичка AI-Proto «как обгонять индекс» (НЕ личные правила)
    // 🧪 Раздел 6: проверенные на истории rule-based прото-сигналы (клиент пишет
    // их в data[tab].btSignals при бэктесте). Сливаем по всем вкладкам в карту тикеров.
    protoSignals: mergeProtoSignals(snap),
    protoLegend: '{ТИКЕР:{s:прото-сигнал[-1..+1], v:long|reduce|neutral, h:hit-rate% на отложенной выборке|null}} — детерминированный rule-based сигнал (SMA/RSI/ATR/уровни), проверенный на 2-летней истории; есть не по всем тикерам.',
  };
  // 🆚 Самооценка: результат портфеля с начала vs индексы (alpha = обгон/отставание).
  try{
    const portReturnPct = ap.startCapital > 0 ? Math.round((equity / ap.startCapital - 1) * 1000) / 10 : null;
    const benches = await aipBenchmarks(env, ap.startedAt);
    payload.performance = {
      sinceStart: new Date(ap.startedAt).toISOString().slice(0, 10),
      portfolioReturnPct: portReturnPct,
      vsIndex: benches.map(b => ({ index: b.index, indexReturnPct: b.returnPct, alphaPct: portReturnPct != null ? Math.round((portReturnPct - b.returnPct) * 10) / 10 : null })),
      // Тренд альфы во времени (дневные снимки прошлых циклов) — обгон растёт или падает.
      history: (ap.perfHistory || []).slice(-16).map(x => ({ d: x.d, ret: x.ret, alpha: x.alpha })),
    };
  }catch(e){}
  // Вердикты скоринга по тикерам — для жёсткой проверки на исполнении.
  // Пустой сохранённый вердикт добиваем автономным расчётом worker'а — щель
  // «вкладка давно не обновлялась на сайте» закрыта.
  const recoBy = {};
  payload.universe.forEach(u => { if(!u[15]) u[15] = aipVerdict(u); recoBy[String(u[0]).toUpperCase()] = u[15]; });
  // reason обязан ссылаться на вердикт, когда сделка идёт против него.
  const mentionsReco = t => /reco|вердикт|скоринг|wait|avoid|ждать|опасн/i.test(String(t || ''));
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: aiModel('aiport'),
      max_tokens: 6000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: AIPORT_SCHEMA } },
      system: cacheSys(AIPORT_SYSTEM),
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    }),
  });
  if(!r.ok) throw new Error('Claude API ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  const raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed = { decisions: [], note: '' };
  try{ const p = JSON.parse(raw); if(p && Array.isArray(p.decisions)) parsed = p; }catch(e){ /* нет решений */ }
  // ── Исполнение с валидацией ──
  const trades = [], skipped = [];
  for(const dec of parsed.decisions.slice(0, 20)){   // мех. предохранитель по бюджету subrequest (не стратегический лимит)
    const tk = String(dec.ticker || '').trim().toUpperCase();
    const qty = Math.floor(Math.abs(parseFloat(dec.qty) || 0));
    if(!tk || !(qty > 0)){ skipped.push(`${tk || '?'}: некорректное решение`); continue; }
    if(dec.action === 'sell'){
      const p = positions.find(x => String(x.ticker).toUpperCase() === tk);
      if(!p){ skipped.push(`sell ${tk}: нет позиции`); continue; }
      if(!marketsOpen[String(p.ccy).toUpperCase()]){ skipped.push(`sell ${tk}: рынок ${p.ccy} закрыт`); continue; }
      // 🤖 автономия: вердикт скоринга — справочный, не блокирует сделку
      const q = quotes[p.ticker] || await yahoo(exSymbol(p.ticker, p.ccy));
      if(!(q && q.price > 0)){ skipped.push(`sell ${tk}: нет котировки`); continue; }
      const sellQty = Math.min(qty, p.qty), f = fx[p.ccy] || 1;
      const gross = sellQty * q.price * f;
      const fee = Math.round(tradeFeeNativeW(p.ccy, sellQty * q.price, false) * f);
      ap.cashSEK = (ap.cashSEK || 0) + gross - fee;
      const pl = Math.round((q.price - p.avgBuy) * sellQty * f - fee);   // P&L нетто
      p.qty -= sellQty;
      if(p.qty <= 0) positions.splice(positions.indexOf(p), 1);
      trades.push({ id: 't' + now + '_' + trades.length, ts: now, action: 'sell', ticker: p.ticker, name: p.name, qty: sellQty, price: q.price, ccy: p.ccy, fx: f, amountSEK: Math.round(gross), feeSEK: fee, plSEK: pl, reason: String(dec.reason || '').slice(0, 300), trigger: String(dec.trigger || '').slice(0, 120) });
    }else if(dec.action === 'buy'){
      const r0 = aipFindRow(snap, tk);
      const exist = positions.find(x => String(x.ticker).toUpperCase() === tk);
      const ccy = exist ? exist.ccy : (r0 ? String(r0[8] || 'USD') : null);
      if(!ccy){ skipped.push(`buy ${tk}: вне вселенной`); continue; }
      if(!marketsOpen[String(ccy).toUpperCase()]){ skipped.push(`buy ${tk}: рынок ${ccy} закрыт`); continue; }
      // 🤖 автономия: вердикт скоринга — справочный, не блокирует сделку
      const q = await yahoo(exSymbol(tk, ccy));
      if(!(q && q.price > 0)){ skipped.push(`buy ${tk}: нет котировки`); continue; }
      const f = fx[ccy] || 1;
      const gross = qty * q.price * f;
      const fee = Math.round(tradeFeeNativeW(ccy, qty * q.price, true) * f);
      if(gross < (ap.minTradeSEK || 5000)){ skipped.push(`buy ${tk}: ${Math.round(gross)} kr < мин. сделки`); continue; }
      if(gross + fee > (ap.cashSEK || 0)){ skipped.push(`buy ${tk}: не хватает кэша (${Math.round(gross)} > ${Math.round(ap.cashSEK)})`); continue; }
      ap.cashSEK -= gross + fee;
      let p = exist;
      if(p){ p.avgBuy = Math.round((p.avgBuy * p.qty + q.price * qty) / (p.qty + qty) * 100) / 100; p.qty += qty; }
      else{
        p = { ticker: tk, name: r0 ? String(r0[1] || tk) : tk, ccy, qty, avgBuy: q.price, openedAt: now,
              type: r0 ? String(r0[5] || '') : '', sector: r0 ? String(r0[4] || '') : '' };
        positions.push(p);
      }
      p.lastPrice = q.price;
      quotes[p.ticker] = q;
      trades.push({ id: 't' + now + '_' + trades.length, ts: now, action: 'buy', ticker: tk, name: p.name, qty, price: q.price, ccy, fx: f, amountSEK: Math.round(gross), feeSEK: fee, plSEK: null, reco: recoBy[tk] || null, reason: String(dec.reason || '').slice(0, 300), trigger: String(dec.trigger || '').slice(0, 120) });
    }
  }
  positions.forEach(p => { const q = quotes[p.ticker]; if(q && q.price > 0) p.lastPrice = q.price; });
  // Дневная точка equity (одна на дату) — для графика «Я vs AI».
  const eq2 = Math.round((ap.cashSEK || 0) + positions.reduce((a, p) => a + p.qty * (p.lastPrice || p.avgBuy) * (fx[p.ccy] || 1), 0));
  const dkey = new Date().toISOString().slice(0, 10);
  ap.equityHistory = ((ap.equityHistory || []).filter(x => x.d !== dkey).concat([{ d: dkey, v: eq2 }])).slice(-800);
  // Дневной снимок альфы (обгон индексов) — для истории «обгона» во времени.
  try{
    const retNow = ap.startCapital > 0 ? Math.round((eq2 / ap.startCapital - 1) * 1000) / 10 : null;
    const vi = payload.performance && Array.isArray(payload.performance.vsIndex) ? payload.performance.vsIndex : [];
    if(retNow != null && vi.length){
      const alpha = {};
      vi.forEach(b => { if(b.indexReturnPct != null) alpha[b.index] = Math.round((retNow - b.indexReturnPct) * 10) / 10; });
      ap.perfHistory = ((ap.perfHistory || []).filter(x => x.d !== dkey).concat([{ d: dkey, ret: retNow, alpha }])).slice(-200);
    }
  }catch(e){}
  ap.trades = ((ap.trades || []).concat(trades)).slice(-400);
  ap.lastRunAt = now;
  ap.lastNote = String(parsed.note || '').slice(0, 600);
  // ── Запись СНАЧАЛА durable, Telegram — только после подтверждения ──
  // Сверка на сброс: клиент мог обнулить портфель, пока шёл цикл.
  const freshPre = await loadRow(env);
  if(freshPre){
    const fap = (freshPre.snap && freshPre.snap.aiPort) || {};
    if((fap.startedAt || 0) > (ap.startedAt || 0)){
      return 'Портфель обнулён во время цикла — результаты отброшены, следующий цикл стартует с чистого счёта';
    }
    mergeAiPortSettings(ap, fap, AIPORT_RUN_SETTINGS);   // клиентские настройки из свежей копии
  }
  // 1) Несгораемый якорь в ai_state (без guard → надёжный коммит) — источник правды.
  const bakOk = await saveBak(env, row.userId, ap);
  // 2) Ledger (с детектом коммита + повтором), чтобы сайт показал сделки без вкладки 🤖.
  const ledgerOk = await writeAiPortChecked(env, snap => {
    const fap = (snap && snap.aiPort) || {};
    mergeAiPortSettings(ap, fap, AIPORT_RUN_SETTINGS);   // настройки могли смениться между повторами
    snap.aiPort = ap;
    snap.aiPortBak = JSON.parse(JSON.stringify(ap));     // быстрый резерв в той же строке
  });
  // 3) Telegram — ТОЛЬКО если состояние durable-сохранено (ai_state или ledger).
  // Иначе придерживаем уведомления (никаких фантомных сделок) — сделки подтянутся
  // примирением (aiPortAuthoritative) на следующем цикле/вкладке.
  const durable = bakOk || ledgerOk;
  if(durable){
    for(const t of trades){
      try{
        await sendTelegram(env, `🤖 <b>AI ПОРТФЕЛЬ — ${t.action === 'buy' ? '🟢 ПОКУПКА' : '🔴 ПРОДАЖА'}</b>\n<b>${esc(t.name || t.ticker)}</b> (${esc(t.ticker)}): ${t.qty} × ${t.price} ${t.ccy} ≈ <b>${t.amountSEK} kr</b>${t.plSEK != null ? `\nP&amp;L сделки: <b>${t.plSEK >= 0 ? '+' : ''}${t.plSEK} kr</b>` : ''}${t.trigger ? `\n⚡ ${esc(t.trigger)}` : ''}${t.reco && t.reco !== 'buy' ? `\n📋 вердикт скоринга: ${t.reco}` : ''}\n${esc(t.reason)}`);
      }catch(e){}
    }
  }else if(trades.length){
    try{ await sendTelegram(env, `⚠️ <b>AI ПОРТФЕЛЬ</b>: цикл посчитал ${trades.length} сделок, но НЕ удалось сохранить состояние (Supabase). Уведомления придержаны — сделки применятся примирением на следующем цикле.`); }catch(e){}
  }
  return `AI портфель: сделок ${trades.length} · equity ${eq2} kr · кэш ${Math.round(ap.cashSEK)} kr` +
    (skipped.length ? `\nОтклонено: ${skipped.join('; ')}` : '') +
    (ap.lastNote ? `\n💭 ${ap.lastNote}` : '');
}

// ── 📈 Авто-анализ реальных портфелей (Dima/Anna) в цикле AI-портфеля ──────
// При нажатии «Запустить цикл сейчас» (и на cron) worker не только ведёт свой
// виртуальный портфель, но и анализирует реальные портфели владельца, давая по
// каждому рекомендации (купить/докупить/сократить/продать/держать). Результат
// пишется в data[key].analysis, клиент рисует его во вкладке «📈 Анализ».
// Структурный вывод (json_schema), без web_search — дёшево на часовом цикле;
// глубокий FED-aware разбор с веб-поиском остаётся на ручной кнопке AI Proto.
const PFANALYZE_SYSTEM = `Ты — AI Proto, главная аналитическая модель инвестиционного дашборда частного инвестора из Швеции (базовая валюта — шведская крона, kr). Тебе передают JSON-снапшот ОДНОГО реального портфеля (поле portfolioName): позиции с живыми ценами, P&L, долями, уровнями SMA 50/100/200, поддержкой/сопротивлением, консенсус-таргетами; аллокацию по секторам; свободный кэш; recoVerdicts (детерминированный вердикт скоринга сайта по тикерам, легенда — recoLegend); liveMarkets (живые фьючерсы/индексы/доходности/доллар — risk-фон и реакция на FED); при наличии — playbook.

ЗАДАЧА: дай по этому портфелю КОНКРЕТНЫЕ рекомендации, что делать с каждой значимой позицией и какие новые идеи добавить, нацеленные на опережение эталонных индексов (OMXS30, Nasdaq 100, S&P 500) при разумном риске. Работай автономно по фактам снапшота и плейбуку; цифры портфеля бери из снапшота, не выдумывай.

ПРАВИЛА:
- Каждое действие — из набора: «Купить» (новая позиция), «Докупить» (увеличить существующую), «Сократить» (уменьшить), «Продать» (закрыть), «Держать». Увеличить = Докупить, уменьшить = Сократить.
- Опирайся на технику (положение относительно SMA/поддержки/сопротивления, перегрев, падающий нож), оценку (потенциал к таргету) и риск (концентрация, тип бумаги). У позиций может быть betygLite — ГРУБЫЙ прокси качества по ROE и росту выручки (0–100 + буква). ВАЖНО: это НЕ полный фундамент-рейтинг из карточки (тот учитывает маржу, FCF, баланс), и для финансов/PE/банков ROE его искажает — поэтому НЕ выноси по betygLite жёсткий вердикт «фундамент плохой» сам по себе, используй его лишь как мягкий ориентир вместе с маржой/ростом/долгом и техникой. Для каждой рекомендации в details укажи уровень входа/выхода и краткую причину; amountSEK — ориентировочная сумма в kr или null.
- СОГЛАСОВАННОСТЬ С КАРТОЧКОЙ: если рекомендация против recoVerdict (например, Докупить при recoVerdict=sell/avoid, или Сократить при buy) — кратко оговори расхождение и разведи по горизонтам.
- ПОБЕДИТЕЛЕЙ НЕ РЕЖЬ РАДИ ДИВЕРСИФИКАЦИИ: сильные прибыльные растущие позиции сокращай только по объективной причине (перегрев/выше таргета/слом тренда/ухудшение фундаментала/опасная концентрация). Недовес закрывай кэшем и новыми идеями.
- МОМЕНТУМ — НЕ УПУСКАЙ ПРИБЫЛЬ (урок): сильную растущую позицию в подтверждённом аптренде (выше SMA50/200, растущий моментум, тезис цел) НЕ рекомендуй «Сократить/Продать» только из-за перегрева, растянутости над SMA или близости к сопротивлению/таргету — в моментум-режиме уровни и таргеты пробиваются, таргеты поднимают вслед за ценой. Режь только при конкретной деградации (слом тренда под SMA50/200, негативный катализатор, ухудшение фундаментала, опасная концентрация); иначе «Держать» или трейлить часть. Симметрично: качественную бумагу в сильном тренде с катализатором не упускай ради глубокого отката — оправдан «Докупить/Купить» сейчас или частично с добором на откатах.
- Учитывай liveMarkets как текущий risk-фон (VIX, доходности, доллар, реакция на FED) для тайминга.
- protoSignals (легенда — protoLegend, есть не по всем тикерам) — проверенный на 2y истории rule-based прото-сигнал с hit-rate (h): высокий h подтверждает знак сигнала, низкий — ослабляет. Учитывай как вес доверия к технике вместе с recoVerdict.
- summary: 2–3 предложения о состоянии портфеля и главном выводе. report: краткий разбор в markdown (состояние, что докупить, что сократить/продать, новые идеи, риски). actions: список конкретных рекомендаций.

Верни ответ СТРОГО по заданной JSON-схеме. Это аналитическая сводка, не индивидуальная инвестиционная рекомендация.`;
const PFANALYZE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2–3 предложения о состоянии портфеля и главном выводе' },
    report: { type: 'string', description: 'Краткий разбор в markdown' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['Купить', 'Докупить', 'Сократить', 'Продать', 'Держать'] },
          name: { type: 'string' },
          ticker: { type: 'string' },
          details: { type: 'string' },
          amountSEK: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
        required: ['action', 'name', 'ticker', 'details', 'amountSEK'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'report', 'actions'],
  additionalProperties: false,
};
// 🏅 Лёгкий фундамент-рейтинг «betyg» по строке (ROE + рост выручки) → 0–100 + буква.
// Зеркалит клиентский pf3RowBetyg в случае, когда столп оценки недоступен (val=null):
// нормирует по присутствующим столпам prof(0.4)/grow(0.3). Та же шкала букв (PF3_GRADE).
function rowBetygLite(roe, revg){
  const prof = roe > 0 ? (roe >= 20 ? 10 : roe >= 15 ? 9 : roe >= 10 ? 7 : roe >= 5 ? 5 : 4) : (roe < 0 ? 1 : null);
  const grow = (typeof revg === 'number' && revg !== 0) ? (revg >= 20 ? 10 : revg >= 10 ? 8 : revg >= 4 ? 6 : revg > 0 ? 5 : revg > -10 ? 3 : 1) : null;
  const W = { prof: 0.4, grow: 0.3 };
  let sw = 0, wsum = 0;
  [['prof', prof], ['grow', grow]].forEach(([k, v]) => { if(v != null){ sw += v * W[k]; wsum += W[k]; } });
  if(!wsum) return null;
  const s = sw / wsum;
  const g = s >= 8.5 ? 'A+' : s >= 7.5 ? 'A' : s >= 6.5 ? 'B' : s >= 5 ? 'C' : s >= 3.5 ? 'D' : 'F';
  return { score100: Math.round(s * 10), grade: g };
}
// Серверный аналог pf3AiSnapshot для портфеля: строки вкладки + живые котировки
// Yahoo → позиции с уровнями/долями, аллокация, кэш, recoVerdict на тикер.
const PFANALYZE_LEGEND = '{ТИКЕР:[recoVerdict(buy|wait|sell|avoid), upside%toTarget, %отSMA50, %отSMA200, P/E]} — детерминированный скоринг сайта (та же логика, что вердикт «Рекомендация» в карточке).';
async function buildPortfolioSnapshot(env, key, snap){
  const d = snap && snap.data && snap.data[key];
  if(!d || !Array.isArray(d.rows) || !d.rows.length) return null;
  const h = d.headers || [];
  const ix = {
    s50: h.findIndex(x => /sma.?50$/i.test(x)), s100: h.findIndex(x => /sma.?100/i.test(x)), s200: h.findIndex(x => /sma.?200/i.test(x)),
    sup: h.indexOf('Поддержка'), res: h.indexOf('Сопротивление'),
    tg: h.findIndex(x => /аналит/i.test(x)), tgr: h.findIndex(x => /таргет 3м/i.test(x)),
    pe: h.indexOf('P/E'), beta: h.indexOf('Beta'), roe: h.indexOf('ROE'), revg: h.indexOf('Рост выручки'),
  };
  const fx = Object.assign({}, FX_DEFAULT, snap.fx || {});
  const num = (r, i) => { const v = i >= 0 ? parseFloat(r[i]) : NaN; return isFinite(v) ? v : null; };
  // Живые котировки по позициям — как в торговом цикле.
  const quotes = {};
  await Promise.all(d.rows.map(async r => {
    const tk = String(r[2] || '').trim(); if(!tk) return;
    quotes[tk] = await yahoo(exSymbol(tk, r[8] || 'USD')).catch(() => null);
  }));
  const positions = [], recoVerdicts = {};
  let totalVal = 0;
  for(const r of d.rows){
    const tk = String(r[2] || '').trim(); if(!tk) continue;
    const ccy = String(r[8] || 'USD');
    const q = quotes[tk] || {};
    const price = (q && q.price > 0) ? round2(q.price) : num(r, 7);
    if(!(price > 0)) continue;
    const qty = num(r, 6) || 0, f = fx[ccy] || 1;
    const sma50 = (q && q.sma50) || num(r, ix.s50), sma100 = (q && q.sma100) || num(r, ix.s100), sma200 = (q && q.sma200) || num(r, ix.s200);
    const support = (q && q.support) || num(r, ix.sup), resistance = (q && q.resistance) || num(r, ix.res);
    const buy = num(r, 9);
    const valueSEK = Math.round(qty * price * f);
    totalVal += valueSEK;
    // Эффективный таргет (свежий «Таргет 3м» при устаревшем консенсусе ≥10%).
    const tgMain = num(r, ix.tg), tgRec = num(r, ix.tgr);
    const tg = (tgMain > 0 && tgRec > 0 && Math.abs(tgRec - tgMain) / tgMain * 100 >= 10) ? tgRec : (tgMain || tgRec);
    const dist = v => (v && v > 0) ? Math.round((price - v) / v * 1000) / 10 : null;
    // recoVerdict через ту же логику, что в карточке (aipVerdict по universe-строке).
    const uRow = [tk, ccy, String(r[4] || ''), String(r[5] || ''), price, num(r, 10) || 0,
      dist(sma50), dist(sma200), dist(support), dist(resistance),
      (tg && tg > 0) ? Math.round((tg / price - 1) * 1000) / 10 : null,
      num(r, ix.pe), num(r, ix.beta), num(r, ix.roe), num(r, ix.revg), null];
    recoVerdicts[tk.toUpperCase()] = aipVerdict(uRow);
    positions.push({
      name: r[1], ticker: tk, sector: r[4] || '—', ccy,
      qty, buyPrice: buy, price, valueSEK,
      plPct: (buy > 0) ? Math.round((price / buy - 1) * 1000) / 10 : null,
      sma50, sma100, sma200, support, resistance,
      analystTarget: (tg && tg > 0) ? round2(tg) : null,
      upsidePct: uRow[10],
      // ⚠️ ГРУБЫЙ прокси качества по ROE/росту (НЕ равен карточному 5-столповому
      // betyg: тот учитывает маржу/FCF/баланс). Для финансов/PE/банков ROE искажает —
      // не выносить по нему жёсткий вердикт. Полный betyg доступен в карточке/AI Proto.
      betygLite: rowBetygLite(num(r, ix.roe), num(r, ix.revg)),
    });
  }
  if(!positions.length) return null;
  positions.forEach(p => { p.sharePct = totalVal > 0 ? Math.round(p.valueSEK / totalVal * 1000) / 10 : 0; });
  const bySector = {};
  positions.forEach(p => { bySector[p.sector] = (bySector[p.sector] || 0) + p.valueSEK; });
  const allocation = Object.entries(bySector).map(([name, v]) => ({ name, pct: totalVal > 0 ? Math.round(v / totalVal * 1000) / 10 : 0 })).sort((a, b) => b.pct - a.pct);
  const cashSEK = Math.round((parseFloat(d.cashFree) || 0) * (fx[String(d.baseCcy || 'SEK').toUpperCase()] || 1));
  return {
    portfolioName: d.title || d.subtitle || key,
    baseCurrency: 'SEK', fxToSEK: fx,
    positions, allocation,
    totals: { stocksSEK: Math.round(totalVal), freeCashSEK: cashSEK },
    recoLegend: PFANALYZE_LEGEND,
    recoVerdicts,
    playbook: Array.isArray(snap.aiPlaybook) ? snap.aiPlaybook : [],
    // 🧪 Раздел 6: прото-сигналы бэктеста по этому портфелю (пишет клиент).
    protoSignals: (d.btSignals && typeof d.btSignals === 'object') ? d.btSignals : null,
    protoLegend: '{ТИКЕР:{s:прото-сигнал[-1..+1], v:long|reduce|neutral, h:hit-rate% на отложенной выборке|null}} — детерминированный rule-based сигнал, проверенный на 2y истории.',
  };
}
async function portfolioAnalyze(env, key, snap){
  const payload = await buildPortfolioSnapshot(env, key, snap);
  if(!payload) return null;
  payload.liveMarkets = await liveMarkets().catch(() => []);
  payload.today = new Date().toISOString().slice(0, 10);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: aiModel('portfolio'),
      max_tokens: 6000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: PFANALYZE_SCHEMA } },
      system: cacheSys(PFANALYZE_SYSTEM),
      messages: [{ role: 'user', content: 'Снапшот портфеля (JSON):\n' + JSON.stringify(payload) }],
    }),
  });
  if(!r.ok) throw new Error('Claude API ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  const raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed = null; try{ parsed = JSON.parse(raw); }catch(e){}
  if(!parsed || !Array.isArray(parsed.actions)) throw new Error('Пустой/некорректный ответ анализа');
  return { summary: String(parsed.summary || ''), report: String(parsed.report || ''), actions: parsed.actions, cost: aiCost(j), at: new Date().toISOString() };
}
// Прогон авто-анализа по всем реальным портфелям. Гейт по pfAnalysisAt (cron —
// не чаще раза в час); force=true (кнопка) считает сейчас. Пишет в data[key].analysis.
async function runPortfolioAnalyses(env, force){
  if(!env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY не задан';
  const row = await loadRow(env);
  const snap = row && row.snap;
  if(!snap || !snap.data) return 'Нет данных портфелей';
  const now = Date.now();
  if(!force && snap.pfAnalysisAt && now - snap.pfAnalysisAt < PFANALYSIS_INTERVAL_MS){
    return `Рано: авто-анализ портфелей через ${Math.ceil((snap.pfAnalysisAt + PFANALYSIS_INTERVAL_MS - now) / 60e3)} мин`;
  }
  const results = {};
  for(const key of ANALYZE_PORTFOLIOS){
    if(!snap.data[key]) continue;
    try{ const a = await portfolioAnalyze(env, key, snap); if(a) results[key] = a; }
    catch(e){ results[key] = { error: String((e && e.message) || e) }; }
  }
  if(!Object.keys(results).length) return 'Портфели для анализа не найдены';
  // Перечитываем свежую строку и пишем анализ, не затирая параллельные изменения.
  const fresh = await loadRow(env);
  if(fresh && fresh.snap && fresh.snap.data){
    for(const [key, a] of Object.entries(results)){
      if(a.error || !fresh.snap.data[key]) continue;
      const d = fresh.snap.data[key];
      const entry = { at: a.at, summary: a.summary, report: a.report, actions: a.actions, cost: a.cost };
      d.analysis = entry;
      d.analysisHistory = [entry, ...(d.analysisHistory || [])].slice(0, 5);
    }
    fresh.snap.pfAnalysisAt = now;
    await writeRow(env, fresh.userId, fresh.snap);
  }
  // Telegram-сводка по каждому портфелю.
  for(const [key, a] of Object.entries(results)){
    if(a.error){ try{ await sendTelegram(env, `📈 <b>Анализ ${esc(key)}</b>: ошибка — ${esc(a.error)}`); }catch(e){} continue; }
    const top = (a.actions || []).filter(x => x && x.action && !/держать/i.test(x.action)).slice(0, 6)
      .map(x => `${/прода|сократ/i.test(x.action) ? '🔴' : '🟢'} ${esc(x.action)} ${esc(x.ticker || x.name || '')}`).join('\n');
    try{ await sendTelegram(env, `📈 <b>Анализ портфеля — ${esc(key)}</b>\n${esc((a.summary || '').slice(0, 300))}${top ? '\n\n' + top : ''}`); }catch(e){}
  }
  const parts = Object.entries(results).map(([k, a]) => `${k}: ${a.error ? 'ошибка' : (a.actions || []).length + ' реком.'}`);
  return 'Авто-анализ портфелей: ' + parts.join(' · ');
}

// ── 🕵 Инсайдерские сделки (Finnhub): сбор, агрегация, кластерные покупки ───
// Finnhub Insider Transactions — только US (SEC Form 4). Соблюдаем 60 req/min;
// при 429 — экспоненциальный backoff. Кластер: ≥3 уникальных инсайдера-
// покупателя в скользящем окне (по умолчанию 10 дней).
async function finnhubInsider(sym, from, to, key){
  const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
  for(let attempt = 0; attempt < 4; attempt++){
    let r;
    try{ r = await fetch(url, { headers: { 'X-Finnhub-Token': key } }); }
    catch(e){ return { err: 'net' }; }
    if(r.status === 429){ await sleep(800 * Math.pow(2, attempt)); continue; }   // backoff
    if(r.status === 401) return { err: 'auth' };
    if(!r.ok) return { err: 'http ' + r.status };
    const j = await r.json().catch(() => null);
    return { data: (j && Array.isArray(j.data)) ? j.data : [] };
  }
  return { err: '429' };
}
// Агрегирует сырые транзакции в сводку: объёмы покупок/продаж, нетто, список
// сделок и кластер покупателей (скользящее окно windowDays).
function insiderAggregate(rows, windowDays){
  const W = windowDays || 10;
  const tx = (rows || []).filter(x => x && x.transactionCode && typeof x.change === 'number')
    .map(x => ({
      name: String(x.name || '').slice(0, 60),
      code: String(x.transactionCode || '').toUpperCase(),
      shares: Math.abs(x.change),
      price: (typeof x.transactionPrice === 'number' && x.transactionPrice > 0) ? x.transactionPrice : null,
      date: x.transactionDate || x.filingDate || null,
      filing: x.filingDate || null,
    }))
    .map(t => ({ ...t, value: t.price != null ? Math.round(t.shares * t.price) : null }))
    .filter(t => t.shares > 0);
  let buyShares = 0, buyUSD = 0, sellShares = 0, sellUSD = 0;
  for(const t of tx){
    if(t.code === 'P'){ buyShares += t.shares; buyUSD += t.value || 0; }
    else if(t.code === 'S'){ sellShares += t.shares; sellUSD += t.value || 0; }
  }
  // Кластер покупок: P-сделки, скользящее окно W дней, ≥3 уникальных имени.
  const buys = tx.filter(t => t.code === 'P' && t.date).sort((a, b) => a.date < b.date ? -1 : 1);
  let cluster = null;
  for(let i = 0; i < buys.length; i++){
    const start = new Date(buys[i].date).getTime(), names = new Set(), inWin = [];
    for(let k = i; k < buys.length; k++){
      if(new Date(buys[k].date).getTime() - start > W * 86400e3) break;
      names.add(buys[k].name); inWin.push(buys[k]);
    }
    if(names.size >= 3 && (!cluster || names.size > cluster.uniqueBuyers)){
      cluster = { uniqueBuyers: names.size, windowDays: W,
        fromDate: inWin[0].date, toDate: inWin[inWin.length - 1].date,
        sumUSD: inWin.reduce((a, t) => a + (t.value || 0), 0) };
    }
  }
  return {
    buyShares, buyUSD: Math.round(buyUSD), sellShares, sellUSD: Math.round(sellUSD),
    netUSD: Math.round(buyUSD - sellUSD), txCount: tx.length,
    tx: tx.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 15),
    cluster,
  };
}

// 🇸🇪 Реестр инсайдерской торговли Швеции — Finansinspektionen (Insynshandel),
// официальный, бесплатный, без ключа. CSV-экспорт UTF-16LE, разделитель ';',
// поиск по имени эмитента (Utgivare). Karaktär: Förvärv/Teckning → покупка (P),
// Avyttring → продажа (S). Возвращает строки в формате finnhubInsider().
const fiIssuer = name => String(name || '')
  .replace(/\s+(ser\.?\s*)?[A-D]$/i, '')           // класс акции: «B», «ser. A»
  .replace(/\s+(pref|stam)$/i, '')
  .replace(/\s+(AB|ASA|A\/S|OYJ|PLC)\b\.?/i, '')   // юр. форма — FI ищет по основе
  .trim();
async function fiInsider(issuer, from, to){
  if(!issuer) return { data: [] };
  try{
    const url = `https://marknadssok.fi.se/Publiceringsklient/sv-SE/Search/Search?SearchFunctionType=Insyn&Utgivare=${encodeURIComponent(issuer)}&Transaktionsdatum.From=${from}&Transaktionsdatum.To=${to}&button=export&Page=1`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/csv' } });
    if(!r.ok) return { err: 'http ' + r.status };
    const text = new TextDecoder('utf-16le').decode(await r.arrayBuffer());
    const lines = text.split(/\r?\n/).filter(l => l.indexOf(';') >= 0);
    if(lines.length <= 1) return { data: [] };
    const numSe = s => { const n = parseFloat(String(s || '').replace(/[\s ]/g, '').replace(',', '.')); return isFinite(n) ? n : null; };
    const out = [];
    for(let i = 1; i < lines.length; i++){
      const c = lines[i].split(';');   // 0 Publ · 1 Emittent · 4 PDMR · 11 Karaktär · 12 Instrumenttyp · 15 TxDate · 16 Volym · 18 Pris
      if(c.length < 20) continue;
      if(!/aktie/i.test(c[12] || '')) continue;   // только акции — НЕ свопы/облигации/деривативы (там Volym = номинал, не штуки)
      const kar = String(c[11] || '').toLowerCase();
      const code = /f[öo]rv[äa]rv|teckn/.test(kar) ? 'P' : /avyttr/.test(kar) ? 'S' : null;
      if(!code) continue;
      const shares = numSe(c[16]);
      if(!(shares > 0)) continue;
      out.push({
        name: String(c[4] || c[3] || '').slice(0, 60),
        transactionCode: code,
        change: shares,
        transactionPrice: numSe(c[18]),
        transactionDate: String(c[15] || '').slice(0, 10) || null,
        filingDate: String(c[0] || '').slice(0, 10) || null,
      });
    }
    return { data: out };
  }catch(e){ return { err: 'net' }; }
}

// ── 🔬 AI-анализ одной акции с веб-поиском новостей (карточка → кнопка) ─────
// Клиент шлёт снапшот акции (цена, SMA, уровни, фундаментал, таргет) + контекст
// портфеля (доли по секторам, концентрация, кэш) + журнал прошлых анализов по
// этому тикеру (для сверки прогноз↔факт — «обучение»). Claude с web_search
// собирает свежие новости и возвращает структурированный разбор + JSON-сводку.
// FENCE объявлен в начале файла (нужен и для AI_SYSTEM выше).
const STOCKAI_SYSTEM = `Ты — старший инвестиционный аналитик. Тебе передают JSON по ОДНОЙ акции: цена, технические уровни (SMA 50/100/200, поддержка, сопротивление), фундаментал (P/E, P/S, выручка, маржа, долг/капитал, рост), консенсус-таргет аналитиков, тип и сектор; контекст портфеля инвестора (текущие доли по секторам, концентрация, свободный кэш в SEK, базовая валюта SEK); и priorAnalyses — твои прошлые разборы этой бумаги с ценой на тот момент (сверь прогноз с фактом — где ошибся, где попал — и откалибруй уверенность).

ОБЯЗАТЕЛЬНО используй web_search для свежих новостей и событий по компании (отчёты, гайденс, сделки, регуляторика, отраслевой фон) — на дату анализа. Кратко сошлись на найденное в разделе новостей. Бюджет поиска ограничен (~90 сек): 2–4 точечных запроса, без дублей, затем сведи найденное.

В снапшоте есть liveMarkets — живые фьючерсы и индексы с дневным изменением % (US-фьючерсы ES/NQ/YM/RTY, VIX, золото, нефть, OMXS30/DAX/Euro Stoxx/Nikkei). Это направление риска ПРЯМО СЕЙЧАС (фьючерсы идут ~23ч, включая пре-маркет США). Сильное движение фьючерсов или скачок VIX особенно влияют на горизонт «Момент» (вход сейчас) — учитывай это в выводе.

ФУНДАМЕНТ-РЕЙТИНГ И ОБЪЁМ. В снапшоте могут быть: betyg — фундаментальный рейтинг бумаги (score100 0–100, буква grade A–F и 5 столпов: прибыльность/рост/баланс/денежный поток/оценка) — используй его как сводную оценку КАЧЕСТВА бизнеса (высокий betyg = качество, оправдывает премию и удержание; низкий — осторожнее с лонгом); fundamentals.revSeries — история выручки по периодам с ростом г/г (траектория: ускоряется/замедляется — отрази в тезисе); volume — режим объёма (relToAvg ×N к среднему, regime low|normal|elevated|frenzy, confirmsMove): объём подтверждает движение цены — на горизонте «Момент» сильный объём (elevated/frenzy) усиливает сигнал, низкий (low) делает движение ненадёжным.

Дай разбор на русском языке в markdown строго по разделам:

## 📰 Новости и события
3–5 пунктов: самое важное из веб-поиска за последние недели, с влиянием на кейс.

## 📊 Состояние акции
Техника (тренд относительно SMA, близость к уровням) + фундаментал (оценка, рост, прибыльность, долг) в 3–5 предложениях.

## 🚀 Драйверы роста
2–4 конкретных катализатора.

## ⚠️ Риски
2–4 главных риска.

МОМЕНТУМ (учитывай на всех горизонтах, особенно «Момент» — не упускай прибыль). В подтверждённом восходящем тренде с растущим импульсом перегрев, близость к сопротивлению и пройденный путь сами по себе НЕ дают «НЕ ДОБАВЛЯТЬ» — в моментум-режиме уровни и консенсус-таргеты пробиваются, таргеты поднимают вслед за ценой. Качественную бумагу в сильном тренде с катализатором не отправляй в «НАБЛЮДАТЬ» лишь в ожидании глубокого отката, которого может не быть — оправдано «ДОБАВЛЯТЬ» (можно частично, с планом добора). «НЕ ДОБАВЛЯТЬ» по сильному тренду — только при конкретной деградации (слом тренда под SMA50/200, негативный катализатор, ухудшение фундаментала) или цене резко выше таргета с выдыхающимся импульсом.

Дальше дай рекомендацию по ТРЁМ ГОРИЗОНТАМ, собрав актуальные данные под каждый. Для каждого — чёткое действие (ДОБАВЛЯТЬ / НАБЛЮДАТЬ / НЕ ДОБАВЛЯТЬ), обоснование и цифры; учитывай диверсификацию (если сектор уже перевешен — скажи). Горизонты могут расходиться — это нормально, объясни почему.

## ⏱ Момент (сейчас)
Что делать прямо сейчас по живой цене и технике: действие, зоны входа (ценовые уровни), ближайший триггер, рекомендуемый размер позиции (% от капитала и сумма в SEK от свободного кэша).

## 📅 6–9 месяцев
Среднесрочно: действие, целевая цена и потенциал роста (%) на 6–9 мес, ключевые драйверы (отчёты, гайденс, цикл сектора, макро).

## 🚀 Лонг (12+ мес)
Долгосрочно: действие, долгосрочная целевая цена и потенциал (%), инвестиционный тезис (структурный рост, качество бизнеса, конкурентная позиция, оценка).

В САМОМ КОНЦЕ ответа добавь машиночитаемый блок (он не показывается пользователю) — fenced json, открой и закрой его символами ${FENCE} :
${FENCE}json
{"verdict":"add|watch|avoid","sizePct":<число или null>,"sizeSEK":<число или null>,"entryLow":<число или null>,"entryHigh":<число или null>,"targetPrice":<число или null>,"upsidePct":<число или null>,"horizon":"now|mid|long или строка","confidence":"low|medium|high","horizons":{"now":{"verdict":"add|watch|avoid","entryLow":<число|null>,"entryHigh":<число|null>,"note":"<кратко>"},"mid":{"verdict":"add|watch|avoid","targetPrice":<число|null>,"upsidePct":<число %|null>,"note":"<кратко>"},"long":{"verdict":"add|watch|avoid","targetPrice":<число|null>,"upsidePct":<число %|null>,"note":"<кратко>"}}}
${FENCE}
Верхнеуровневый "verdict" — действие на горизонт «сейчас» (now). Цены — в торговой валюте бумаги. В конце основного текста одна строка: «Это аналитическая сводка, а не индивидуальная инвестиционная рекомендация.»`;

async function stockAnalyze(env, body){
  const today = new Date().toISOString().slice(0, 10);
  if(body && typeof body === 'object') body.liveMarkets = await liveMarkets().catch(() => []);
  const j = await anthropicRun(env, {
    model: aiModel('stock'),
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    system: STOCKAI_SYSTEM,
    messages: [{ role: 'user', content: 'Сегодня ' + today + '. Снапшот акции и контекст (JSON):\n' + JSON.stringify(body || {}) }],
  });
  let raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  if(!raw) throw new Error('Пустой ответ модели');
  // Извлечь финальный json-блок (между маркерами FENCE) и убрать его из текста.
  let data = null;
  const i = raw.lastIndexOf(FENCE + 'json');
  if(i >= 0){
    const rest = raw.slice(i + FENCE.length + 4);
    const end = rest.indexOf(FENCE);
    if(end >= 0){ try{ data = JSON.parse(rest.slice(0, end).trim()); }catch(e){} raw = raw.slice(0, i).trim(); }
  }
  return { text: raw, data, cost: aiCost(j) };
}

// ── 🔄 AI-Рекомендация: единый вердикт по карточке акции (техника+фундаментал+
// оценка+новости+макро) с веб-поиском. Отдельно от детерминированного скоринга.
const RECO_SYSTEM = `Ты — старший инвестиционный аналитик. Твоя задача — вынести ЕДИНЫЙ вердикт «Рекомендация» по ОДНОЙ акции для частного инвестора из Швеции (базовая валюта SEK), синтезируя ВСЕ доступные данные: технику, фундаментал, оценку, свежие новости и глобальную макрокартину. Не опирайся на один блок — взвешивай их вместе.

Тебе передают JSON-снапшот карточки акции:
- Идентификация: тикер, компания, биржа/валюта, сектор, тип (Качественная / Рост / Дивидендная / Защитная / Циклическая / Спекулятивная).
- Цена и техника: текущая цена, изменение за день, позиция относительно SMA 50/100/200, поддержка/сопротивление, близость к уровням входа/выхода.
- Фундаментал: P/E (TTM и forward), P/S, EV/EBITDA, PEG, ROE, маржа, рост выручки (YoY и CAGR), долг/капитал (D/E), свободный денежный поток (FCF).
- Оценка: аналит. таргет (консенсус и свежий срез), потенциал к таргету в %, мультипликаторы относительно медианы сектора и собственной истории.
- Контекст портфеля: доля позиции, концентрация по секторам, свободный кэш в SEK.
- recoVerdict — текущий детерминированный вердикт скоринга сайта (техника+фундаментал+риск) и priorAnalyses — твои прошлые разборы: держи последовательность, меняй мнение только при новых данных и объясняй, что изменилось.

ОБЯЗАТЕЛЬНО используй web_search (на дату анализа):
1) Свежие новости и события по компании: отчёты, гайденс, сделки M&A, регуляторика, изменения рейтингов и таргетов аналитиков, инсайдерские сделки.
2) Глобальная макрокартина: ставки ФРС / ЕЦБ / Riksbank, инфляция, геополитика, цены на сырьё и валюты, настроение по сектору и ведущим индексам — и как именно это влияет на ЭТУ бумагу.
Бюджет поиска ограничен (~90 сек): 2–4 точечных запроса, без дублей, затем сведи найденное в вывод.

ФЬЮЧЕРСЫ, СТАВКИ И РИСК-ФОН. В снапшоте есть liveMarkets — живые фьючерсы и индексы с дневным изменением % (US-фьючерсы ES/NQ/YM/RTY, VIX, золото, нефть, доходности US-облигаций 10Y/13w, индекс доллара, OMXS30/DAX/Euro Stoxx/Nikkei). Фьючерсы и доходности идут почти круглосуточно и показывают направление риска ПРЯМО СЕЙЧАС (в т.ч. пре-маркет США); скачок VIX — рост страха. Сильное движение фьючерсов/VIX особенно влияет на горизонт «Момент» (now): на резком risk-off не входи у уровня без подтверждения; на risk-on у качественной бумаги вход надёжнее. Если недавно было (или на этой неделе предстоит) заседание FED/ЦБ — через web_search установи решение по ставке, гайденс/тон и реакцию 10Y-доходности/доллара, и учти это особенно для бумаг, чувствительных к ставкам (высокий P/E/длинная дюрация, банки/REIT/дивидендные, не-USD).

Методика вердикта (учти каждый блок, отметь, что перевесило):
- ТЕХНИКА: тренд относительно SMA, фаза, расстояние до уровней. Падающий нож и перегрев — против покупки; цена у SMA 50/200 или поддержки при здоровом тренде — за покупку.
- ФУНДАМЕНТАЛ: прибыльность (ROE, маржа), темп роста, долговая нагрузка, качество FCF. Если в снапшоте есть betyg (фундамент-рейтинг score100 0–100 + буква A–F + 5 столпов) — используй его как сводную оценку качества бизнеса; fundamentals.revSeries (история выручки с ростом г/г) — для оценки траектории (ускорение/замедление).
- ОЦЕНКА: дорого/дёшево к таргету, к медиане сектора и к собственной истории; PEG < 1 — рост недооценён. Низкие мультипликаторы часто бывают на ПИКЕ цикла — не путай дешевизну с возможностью.
- ОБЪЁМ: если есть volume (relToAvg ×N к среднему дн. объёму, regime low|normal|elevated|frenzy, confirmsMove) — объём подтверждает движение: сильный объём (elevated/frenzy) усиливает технический сигнал на горизонте «сейчас», низкий (low) делает движение слабым/ненадёжным.
- НОВОСТИ: меняют ли свежие события инвестиционный тезис (позитив / негатив / нейтрально).
- МАКРО: благоприятна ли среда для сектора и географии бумаги прямо сейчас.
- РИСК И ПОРТФЕЛЬ: перевес сектора, концентрация, тип бумаги (для Спекулятивной планка для «buy» выше; для Защитной/Дивидендной важнее стабильность, а не апсайд).
- МОМЕНТУМ (важно для вердикта «сейчас» — не упускай прибыль): в подтверждённом восходящем тренде с растущим импульсом «перегрев», близость к сопротивлению и большой пройденный путь сами по себе НЕ дают «sell» — в моментум-режиме сопротивление и консенсус-таргет пробиваются, таргеты поднимают вслед за ценой. «sell/avoid» по сильному тренду — только при конкретной деградации (слом тренда под SMA50/200, негативный катализатор, ухудшение фундаментала) или цене резко выше таргета с выдыхающимся импульсом. Симметрично: не ставь «wait» по качественной бумаге в сильном тренде с катализатором лишь ради ожидания глубокого отката, который может не прийти — тогда «buy» (можно частично).

Набор вердиктов (для КАЖДОГО горизонта выбери один):
- "buy"   — покупать/докупать: сигналы на этом горизонте за покупку, цена у точки входа.
- "wait"  — ждать/держать: смешанно или цена далеко от входа, ждём триггер (отчёт/событие).
- "sell"  — сократить/продать: дорого / у сопротивления / выше таргета / перегрев / негатив.
- "avoid" — избегать/опасно: падающий нож, серьёзный риск без компенсации.

ГЛАВНОЕ — дай рекомендацию по ТРЁМ ГОРИЗОНТАМ, собрав актуальные данные под каждый:
1) ⏱ МОМЕНТ (сейчас) — что делать прямо сейчас по живой цене и технике: вердикт, зона входа/выхода (конкретные уровни), ближайший триггер. Опора: цена, SMA 50/100/200, поддержка/сопротивление, фаза, самые свежие новости.
2) 📅 6–9 МЕСЯЦЕВ — среднесрок: вердикт, целевой диапазон/таргет на 6–9 мес и потенциал %, ключевые драйверы (ближайшие отчёты и гайденс, фаза цикла сектора, макро на этом горизонте).
3) 🚀 ЛОНГ (12+ мес) — долгосрок: вердикт, долгосрочный таргет и потенциал %, инвестиционный тезис (структурный рост, качество бизнеса, конкурентная позиция, оценка vs история/сектор).
Горизонты МОГУТ расходиться (например «sell сейчас» из-за перегрева, но «buy на лонг») — это нормально; прямо объясни, почему расходятся.

Правила: опирайся на переданные цифры и результаты веб-поиска, не выдумывай данные; конкретные уровни и проценты; если сигналы противоречат — скажи, что перевесило. Цены — в торговой валюте бумаги.

Дай разбор на русском языке в markdown строго по разделам:
## 📰 Новости и макро
## 📊 Техника и фундаментал
## ⏱ Момент (сейчас)
## 📅 6–9 месяцев
## 🚀 Лонг (12+ мес)

В САМОМ КОНЦЕ ответа добавь машиночитаемый блок (пользователю не показывается) — fenced json, открой и закрой его символами ${FENCE} :
${FENCE}json
{"verdict":"buy|wait|sell|avoid","confidence":"low|medium|high","headline":"<одна строка — суть по всем горизонтам>","entryLow":<число или null>,"entryHigh":<число или null>,"keyRisks":["<риск 1>","<риск 2>"],"asOf":"<YYYY-MM-DD>","horizons":{"now":{"verdict":"buy|wait|sell|avoid","entryLow":<число|null>,"entryHigh":<число|null>,"note":"<кратко: что делать сейчас>"},"mid":{"verdict":"buy|wait|sell|avoid","target":<число|null>,"upside":<число %|null>,"note":"<кратко: 6–9 мес>"},"long":{"verdict":"buy|wait|sell|avoid","target":<число|null>,"upside":<число %|null>,"note":"<кратко: лонг>"}}}
${FENCE}
Верхнеуровневый "verdict" = вердикт горизонта "now" (он идёт в поле «Рекомендация» карточки).
В конце основного текста одна строка: «Это аналитическая сводка, а не индивидуальная инвестиционная рекомендация.»`;

async function recoAnalyze(env, body){
  const today = new Date().toISOString().slice(0, 10);
  if(body && typeof body === 'object') body.liveMarkets = await liveMarkets().catch(() => []);
  const j = await anthropicRun(env, {
    model: aiModel('reco'),
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    system: RECO_SYSTEM,
    messages: [{ role: 'user', content: 'Сегодня ' + today + '. Снапшот акции и контекст (JSON):\n' + JSON.stringify(body || {}) }],
  });
  let raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  if(!raw) throw new Error('Пустой ответ модели');
  let data = null;
  const i = raw.lastIndexOf(FENCE + 'json');
  if(i >= 0){
    const rest = raw.slice(i + FENCE.length + 4);
    const end = rest.indexOf(FENCE);
    if(end >= 0){ try{ data = JSON.parse(rest.slice(0, end).trim()); }catch(e){} raw = raw.slice(0, i).trim(); }
  }
  const V = new Set(['buy', 'wait', 'sell', 'avoid']);
  // Верхний вердикт — горизонт «сейчас» (now); фолбэк, если модель его не продублировала.
  const nowV = data && data.horizons && data.horizons.now && data.horizons.now.verdict;
  const cand = (data && data.verdict) || nowV;
  const verdict = cand && V.has(String(cand)) ? cand : null;
  return { text: raw, verdict, data, cost: aiCost(j) };
}

// ── 🔮 AI-прогноз стоимости портфеля на 3 горизонта (web_search) ──
const FORECAST_SYSTEM = `Ты — AI Proto, аналитическая модель инвестиционного дашборда частного инвестора из Швеции (база SEK). Задача — спрогнозировать ВОЗМОЖНУЮ доходность каждой позиции портфеля на ТРИ горизонта: 3 месяца (h3), 6–9 месяцев (h69), 12+ месяцев (h12).

ОБЯЗАТЕЛЬНО используй web_search по ключевым позициям: консенсус-таргеты аналитиков и их свежие пересмотры, прогнозы выручки/прибыли, гайденс, отчёты, катализаторы, отраслевой и макрофон. Бюджет поиска ограничен (~90 сек): несколько ТОЧЕЧНЫХ запросов по самым важным/крупным позициям, затем сведи; по остальным опирайся на переданные метрики и свои знания.

Для каждой бумаги дай ОЖИДАЕМУЮ доходность ЦЕНЫ В ПРОЦЕНТАХ к текущей цене на каждый горизонт (например +8 = ждёшь цену на 8% выше текущей; отрицательные значения допустимы). Это РЕАЛИСТИЧНЫЙ базовый сценарий, не максимум: взвешивай оценку (потенциал к таргету, мультипликаторы), тренд/технику, риск и тип бумаги. У бумаг может быть betyg (фундамент-рейтинг score100 0–100 + буква A–F) — учитывай качество бизнеса: высокий betyg повышает уверенность в положительной доходности на лонге. Горизонты согласованы по нарастающей по модулю (обычно |h12| ≥ |h69| ≥ |h3|), если нет особой причины. Если оснований для движения нет — близко к 0. Если переданы playbook — учитывай его принципы.

В note по каждой бумаге — 1 короткая фраза: главный драйвер/риск. В summary — 1–2 предложения об ожидаемой динамике портфеля.

Ответ — СТРОГО ОДИН блок ${FENCE}json … ${FENCE} по схеме (только тикеры из переданного портфеля, h-поля — числа):
{"stocks":[{"ticker":"MU","h3":6,"h69":12,"h12":20,"note":"…"}],"horizons":{"h3":5,"h69":9,"h12":15},"summary":"…"}
Это аналитическая оценка, не гарантия и не индивидуальная инвестиционная рекомендация.`;
async function forecastGen(env, body){
  const today = new Date().toISOString().slice(0, 10);
  if(body && typeof body === 'object') body.liveMarkets = await liveMarkets().catch(() => []);
  const j = await anthropicRun(env, {
    model: aiModel('reco'),
    max_tokens: 6000,
    thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    system: FORECAST_SYSTEM,
    messages: [{ role: 'user', content: 'Сегодня ' + today + '. Портфель и контекст (JSON):\n' + JSON.stringify(body || {}) }],
  });
  let raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  let fc = null;
  const i = raw.lastIndexOf(FENCE + 'json');
  if(i >= 0){ const rest = raw.slice(i + FENCE.length + 4); const end = rest.indexOf(FENCE); if(end >= 0){ try{ fc = JSON.parse(rest.slice(0, end).trim()); }catch(e){} } }
  if(!fc){ try{ fc = JSON.parse(raw); }catch(e){} }
  if(!fc || !Array.isArray(fc.stocks)) throw new Error('Пустой/некорректный ответ прогноза');
  return { forecast: fc, cost: aiCost(j) };
}

// ── 🧭 Тезис-монитор бумаги: AI строит специфичные для сектора сигнальные метрики ──
const CYCLE_SYSTEM = `Ты — AI Proto, аналитическая модель инвестиционного дашборда. Задача — построить «тезис-монитор» для ОДНОЙ переданной бумаги: компактный набор опережающих сигнальных метрик, по которым отслеживают, цел ли бычий инвестиционный тезис, СПЕЦИФИЧНЫХ ИМЕННО ДЛЯ ЭТОЙ компании и её сектора (а не общий шаблон).

ОБЯЗАТЕЛЬНО используй web_search (на сегодняшнюю дату): подбери отраслевые KPI и пороги, релевантные именно этой бумаге, и достань их СВЕЖИЕ значения. Примеры по секторам:
- Память/полупроводники (как Micron): спот-цены DRAM / индекс TrendForce DXI, недели запасов в канале, capex гиперскейлеров (AWS/MSFT/Meta/Google), контрактные DDR5/NAND/HBM и законтрактованность, валовая маржа, поставки consumer (mobile/PC).
- Банки/финансы: чистая процентная маржа (NIM), рост кредитного портфеля, кредитные потери/резервы, достаточность капитала, траектория ставок ЦБ.
- Оборона/промышленность: портфель заказов (book-to-bill), оборонные бюджеты/контракты, загрузка мощностей, цепочки поставок.
- Биотех/фарма: данные клинических испытаний и катализаторы (PDUFA/FDA), денежная подушка и runway, патентные обрывы, пайплайн.
- Энергетика/сырьё: цена нефти/газа, дисциплина capex, добыча/запасы, спреды переработки.
- Потребительский/ритейл: LFL-продажи и трафик, валовая маржа, запасы, сила бренда/ценовая власть.
- ПО/интернет: рост выручки и NRR, прибыльность/FCF-маржа, отток, конкуренция/AI-дисрапция, оценка.
Если сектор иной — подбери 5–9 самых релевантных KPI сам. Бюджет ~90 сек: несколько ТОЧЕЧНЫХ запросов, без дублей, затем сведи.

Сформируй секции (tiers), 2–3 штуки:
- "Tier 1 · Exit-триггеры" (badgeKind:"alert", badge напр. "действовать за 1 квартал") — жёсткие условия, при которых бычий тезис ломается и пора ВЫХОДИТЬ; 2–4 метрики с КОНКРЕТНЫМИ числовыми порогами.
- "Tier 2 · Trim-триггеры" (badgeKind:"warn", badge напр. "снизить 20–30%") — ранние предупреждения, повод СОКРАТИТЬ позицию; 2–3 метрики.
- "Структурный риск" (badge:null, badgeKind:null) — контекст, не сигнал, что готовит проблему на горизонте лет; 1–3 метрики.

По КАЖДОЙ метрике:
- label — формулировка условия-порога (например "Spot DRAM (DXI) флэт/вниз 2+ недели", "NIM падает 2 кв подряд", "Runway < 12 мес"),
- value — короткая фраза с ТЕКУЩИМ значением/направлением и стрелкой ↑/↓ из web_search (например "растёт ↑", "2–4 нед ↑", "+60% г/г ↑", "~56% ↑"),
- status — "ok" (порог НЕ достигнут, тезис на стороне быка), "warn" (близко к порогу / структурный риск), "alert" (порог достигнут — действовать).

Также верни: title — 1 строка с эмодзи, отражающая суть тезиса (для памяти — "🧭 Сигналы разворота цикла памяти"; иначе — суть драйвера бумаги); phasePos — 0–100, где бумага в своём цикле/истории (0 ранняя стадия, ~50 развитие, 100 зрелость/перегрев); phaseLabels — РОВНО 3 коротких ярлыка стадий именно для этой бумаги; summary — 1–2 предложения о состоянии тезиса и что мониторить в первую очередь; sources — главные источники через « · ». Если передан metricsHint — сохрани эти метрики (можешь дополнить/уточнить).

Ответ — СТРОГО ОДИН блок ${FENCE}json … ${FENCE} по схеме:
{"title":"🧭 …","phasePos":80,"phaseLabels":["ранняя стадия","развитие","зрелость/перегрев"],"summary":"…","sources":"… · …","tiers":[{"title":"Tier 1 · Exit-триггеры","badge":"действовать за 1 квартал","badgeKind":"alert","rows":[{"label":"…","value":"… ↑","status":"ok"}]},{"title":"Tier 2 · Trim-триггеры","badge":"снизить 20–30%","badgeKind":"warn","rows":[{"label":"…","value":"…","status":"ok"}]},{"title":"Структурный риск","badge":null,"badgeKind":null,"rows":[{"label":"…","value":"…","status":"warn"}]}]}
Это аналитическая оценка по открытым данным, не гарантия и не индивидуальная инвестиционная рекомендация.`;
async function cycleGen(env, body){
  const today = new Date().toISOString().slice(0, 10);
  const j = await anthropicRun(env, {
    model: aiModel('reco'),
    max_tokens: 5000,
    thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    system: CYCLE_SYSTEM,
    messages: [{ role: 'user', content: 'Сегодня ' + today + '. Бумага и контекст (JSON):\n' + JSON.stringify(body || {}) }],
  });
  let raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  let cm = null;
  const i = raw.lastIndexOf(FENCE + 'json');
  if(i >= 0){ const rest = raw.slice(i + FENCE.length + 4); const end = rest.indexOf(FENCE); if(end >= 0){ try{ cm = JSON.parse(rest.slice(0, end).trim()); }catch(e){} } }
  if(!cm){ try{ cm = JSON.parse(raw); }catch(e){} }
  if(!cm || !Array.isArray(cm.tiers)) throw new Error('Пустой/некорректный ответ тезис-монитора');
  return { cyclemon: cm, cost: aiCost(j) };
}

// ── 📚 Подтянуть лучшие практики в плейбук (web_search актуальных подходов) ──
const PLAYBOOK_SYSTEM = `Ты — AI Proto, аналитическая модель инвестиционного дашборда. Задача — собрать АКТУАЛЬНЫЕ лучшие практики и принципы, которые помогают портфелю ОБГОНЯТЬ индексы и МАКСИМИЗИРОВАТЬ прибыль, и оформить их как короткие принципы для плейбука.

ОБЯЗАТЕЛЬНО используй web_search: свежие (текущий год) подходы успешных управляющих и исследования по факторам (моментум, качество, тренд-следование), управлению риском и размером позиции, дисциплине входа/выхода, ребалансировке, работе с победителями, типичным ошибкам инвесторов, структурным трендам. Бюджет ~90 секунд: несколько ТОЧЕЧНЫХ запросов, затем синтез.

Тебе передают current — текущий плейбук (массив принципов). Предложи 5–10 НОВЫХ, КОНКРЕТНЫХ, действенных принципов, которых ещё НЕТ в current (без дублей по смыслу). Каждый — одно ёмкое предложение на русском, формулировка-инструкция (что делать), применимая к реальному управлению портфелем; без воды и банальностей.

Ответ — СТРОГО ОДИН блок ${FENCE}json … ${FENCE} по схеме:
{"items":["принцип 1","принцип 2"],"summary":"1 фраза что добавил"}`;
async function playbookGen(env, body){
  const today = new Date().toISOString().slice(0, 10);
  const j = await anthropicRun(env, {
    model: aiModel('reco'),
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    system: PLAYBOOK_SYSTEM,
    messages: [{ role: 'user', content: 'Сегодня ' + today + '. Текущий плейбук (JSON):\n' + JSON.stringify((body && body.current) || []) }],
  });
  let raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  let pb = null;
  const i = raw.lastIndexOf(FENCE + 'json');
  if(i >= 0){ const rest = raw.slice(i + FENCE.length + 4); const end = rest.indexOf(FENCE); if(end >= 0){ try{ pb = JSON.parse(rest.slice(0, end).trim()); }catch(e){} } }
  if(!pb){ try{ pb = JSON.parse(raw); }catch(e){} }
  if(!pb || !Array.isArray(pb.items)) throw new Error('Пустой/некорректный ответ плейбука');
  pb.items = pb.items.map(s => String(s || '').trim()).filter(Boolean).slice(0, 12);
  return { playbook: pb, cost: aiCost(j) };
}

// ── 📊 AI-Dashboard: AI Proto формирует набор карточек с самой полезной
// информацией для портфеля (web_search свежих новостей/макро + память правил).
const DASH_SYSTEM = `Ты — AI Proto, главная аналитическая модель этого инвестиционного дашборда (частный инвестор из Швеции, базовая валюта SEK). Твоя сверхзадача — помогать ВСЕМ портфелям ОПЕРЕЖАТЬ ВСЕ эталонные индексы (OMXS30, Nasdaq 100, S&P 500) и МАКСИМИЗИРОВАТЬ прибыль. Ты работаешь АВТОНОМНО: личные правила инвестора отменены и не ограничивают советы — решай сам по плейбуку и фактам, проактивно и решительно.

Тебе передают JSON по ОДНОМУ конкретному портфелю (его имя — в поле portfolioName; дашборд строится отдельно для каждого портфеля инвестора, например «Портфель 3.0» и «Portfolio (Anna)»): снапшот портфеля (позиции с живыми ценами, уровнями SMA/поддержки, таргетами, мультипликаторами, кэшем и плечом — ОБЯЗАТЕЛЬНО опирайся на реальные позиции ЭТОГО портфеля, не выдумывай состав и не путай с другими портфелями), marketContext (фазы и сводки индексов) и recoVerdicts — детерминированные вердикты скоринга сайта по тикерам (формат в recoLegend; это та же логика, что вердикт «Рекомендация» в карточке акции, плюс флаг «в портфеле»). Также есть recentTrades — журнал уже ИСПОЛНЕННЫХ сделок по этому портфелю (newest-first: дата, действие buy/sell, тикер, кол-во, цена, plSEK — реализованный P/L) и realizedPLSEK. Учитывай его ПЕРЕД советами: не предлагай уже сделанное, не советуй обратное недавней сделке без явной новой причины, сверяй позиции и среднюю цену с историей покупок. У каждой позиции может быть betyg — фундамент-рейтинг бумаги (score100 0–100 + буква A–F): используй его как срез качества бизнеса (высокий — кандидат на удержание/добор, низкий — на ротацию), отрази в карточках возможностей/рисков и в picks. Также могут быть playbook (стратегические принципы «как обгонять индекс» — применяй как рамку), trackRecord (точность прошлых вердиктов — учись на нём) и benchmarks (состав индексов по секторам — показывай недовес конкретно).

СОГЛАСОВАННОСТЬ С КАРТОЧКОЙ (важно — иначе пользователь видит противоречие). По бумагам из recoVerdicts опирайся на эти реальные цифры (вердикт, потенциал к таргету, расстояние до SMA, P/E). Если твоя picks-рекомендация РАСХОДИТСЯ с recoVerdict — например, ты ставишь «Купить/Докупить», а recoVerdict = wait/avoid/sell (особенно на горизонте short 1–3 мес, который близок к «сейчас»), — ты ОБЯЗАН объяснить расхождение прямо в поле why: начни с «reco=wait: …» / «reco=avoid: …» / «reco=sell: …» и причину, почему именно сейчас всё же входить (например «reco=wait: цена далеко от SMA50, но беру на просадке к 120 как ядро»). Если убедительной причины входить ПРЯМО СЕЙЧАС нет, а вердикт wait — ставь действие «Держать» или «Наблюдать», а не «Купить». Не противоречь вердикту молча.

ОБЪЕКТИВНОЕ СОСТОЯНИЕ БУМАГИ — ЕДИНОЕ ДЛЯ ВСЕХ ПОРТФЕЛЕЙ. Характеристика самой акции по фактам (перегрев/растянутость по технике = цена сильно выше SMA; недооценка/дороговизна по оценке = относительно таргета и мультипликаторов; падающий нож; фаза) НЕ ЗАВИСИТ от того, чей это портфель — она берётся из общих данных (recoVerdicts: расстояние до SMA, потенциал к таргету, P/E) и должна звучать ОДИНАКОВО и в моём портфеле, и у Anna. Не называй одну и ту же бумагу «перегретой» в одном портфеле и «недооценённой» в другом. Помни: «перегрев» (техника) и «недооценка» (оценка) — РАЗНЫЕ измерения; если по цифрам бумага одновременно растянута вверх И ниже таргета — скажи об этом честно, а не выбирай удобную половину.

От портфеля зависит только ДЕЙСТВИЕ и акцент, и его нужно ОБОСНОВАТЬ контекстом этого портфеля: held-позиция с большой долей/прибылью → скорее «фиксировать/держать, риск концентрации»; этой бумаги нет или доля мала → скорее «возможность докупить». Объективное состояние одно, рекомендация — по доле, средней цене, концентрации и кэшу ИМЕННО этого портфеля.

ОБЯЗАТЕЛЬНО используй web_search для самой свежей информации: новости по ключевым позициям и кандидатам, отчёты/гайденс, изменения рейтингов и таргетов аналитиков, и глобальная макрокартина (ставки ФРС/ЕЦБ/Riksbank, инфляция, геополитика, сырьё/валюты, настроение по секторам и индексам). Бюджет поиска ограничен (~90 сек): несколько точечных запросов по самому важному, без дублей, затем сведи найденное в карточки/выводы.

В снапшоте есть liveMarkets — живые фьючерсы и индексы с дневным изменением % (US-фьючерсы ES/NQ/YM/RTY, VIX, золото, нефть, доходности US-облигаций 10Y/13w, индекс доллара, OMXS30/DAX/Euro Stoxx/Nikkei): направление риска ПРЯМО СЕЙЧАС (фьючерсы, VIX и доходности идут ~23ч, в т.ч. пре-маркет США). Отрази это в карточке «что важно сегодня» и в таймингe picks (Момент). Если недавно было (или на этой неделе предстоит) заседание FED/ЦБ — через web_search установи решение по ставке, гайденс/dot-plot и тон, реакцию 10Y-доходности/доллара/секторов, и сделай отдельную карточку: как это смещает приоритеты по бумагам ЭТОГО портфеля (рост/высокий P/E чувствительны к доходностям; банки/REIT/дивидендные — к траектории ставок; не-USD позиции — к доллару).

МОМЕНТУМ — НЕ РЕЖЬ И НЕ УПУСКАЙ ПОБЕДИТЕЛЯ (урок: ранняя фиксация и осторожный вход = упущенная прибыль). Бумагу в подтверждённом аптренде (выше SMA50/200, растущий моментум, тезис цел) не помечай «Сократить/Продать» и не давай picks вердикт «фиксировать» только из-за перегрева, растянутости над SMA или близости к сопротивлению/таргету — в моментум-режиме они пробиваются, таргеты поднимают вслед за ценой. Резать/фиксировать только при конкретной деградации (слом тренда под SMA50/200, негативный катализатор, ухудшение фундаментала, опасная концентрация); иначе держать или трейлить часть. Симметрично в picks: сильный тренд с катализатором — оправдан вход сейчас или частичный, а не бесконечное ожидание отката, которого может не быть.

Сформируй ДАШБОРД — набор компактных карточек с САМОЙ ПОЛЕЗНОЙ информацией для этого портфеля прямо сейчас. Карточки выбери сам (6–9 штук), но покрой по смыслу:
- общее состояние портфеля и где он относительно эталонных индексов;
- что важно сегодня / на этой неделе (события, отчёты, свежие новости);
- возможности: что докупить и какие новые идеи (с уровнями входа и долями в kr);
- риски: что сократить / продать и почему (по объективной причине — перегрев/выше таргета/слом тренда/ухудшение фундаментала/опасная концентрация, а НЕ ради диверсификации);
- макро и рынок — как это влияет на портфель;
- диверсификация (перевес / недовес секторов или гео) — недовес закрывай кэшем и новыми позициями, НЕ продажей сильных прибыльных бумаг ради «ровных долей»; победителям давай расти;
- конкретный план действий на ближайшие 1–2 недели с суммами в kr.

Каждая карточка: короткий заголовок + 2–4 пункта с КОНКРЕТИКОЙ (тикеры, уровни, проценты, суммы kr). Без воды. Строго соблюдай investorRules. tone: good (позитив/возможность), warn (внимание), bad (риск), info (нейтрально). Это справочная аналитика, не индивидуальная инвестиционная рекомендация.

ВАЖНО про формат полей (иначе интерфейс покажет мусор):
- headline и каждый bullet — ПРОСТАЯ строка без markdown-заголовков (##), без префиксов списка (—, -, •, 1.) и без переносов строк. Допустим только **жирный** для акцентов.
- bullets — массив строк (НЕ объектов). icon — один эмодзи. tone — строго одно из good|warn|bad|info.

Дополнительно сформируй picks — твои ЛУЧШИЕ рекомендации по акциям как продвинутого ассистента (синтез свежих новостей, макро, фундаментала и техники), сгруппированные по горизонту: short (1–3 мес — импульс/катализаторы), mid (3–6 мес — тренд/оценка/отчёты), long (6–12 мес — фундаментал/недооценка). По 3–5 идей на каждый горизонт (всего 9–15). Можно включать как бумаги портфеля и вотчлистов, так и НОВЫЕ идеи вне портфеля. Для каждой: тикер, компания, действие, зона входа, целевая цена, потенциал % и краткое обоснование (1 строка). Цены — в торговой валюте бумаги.

Верни ТОЛЬКО машиночитаемый блок — fenced json, открой и закрой его символами ${FENCE} :
${FENCE}json
{"asOf":"<YYYY-MM-DD>","headline":"<1–2 предложения: главное о портфеле сейчас>","cards":[{"icon":"<эмодзи>","title":"<заголовок>","tone":"good|warn|bad|info","bullets":["<пункт с конкретикой>","<пункт>"]}],"picks":[{"ticker":"<тикер>","name":"<компания>","horizon":"short|mid|long","action":"Купить|Докупить|Держать|Наблюдать|Сократить|Продать","entry":"<уровень/зона входа>","target":"<целевая цена>","upside":<число %, или null>,"why":"<кратко, 1 строка>","tone":"good|warn|bad|info"}]}
${FENCE}`;

async function dashboardGen(env, snapshot){
  const today = new Date().toISOString().slice(0, 10);
  if(snapshot && typeof snapshot === 'object') snapshot.liveMarkets = await liveMarkets().catch(() => []);
  const j = await anthropicRun(env, {
    model: aiModel('dashboard'),
    max_tokens: 9000,
    thinking: { type: 'adaptive' },
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    system: DASH_SYSTEM,
    messages: [{ role: 'user', content: 'Сегодня ' + today + '. Снапшот портфеля (JSON):\n' + JSON.stringify(snapshot || {}) }],
  });
  let raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  if(!raw) throw new Error('Пустой ответ модели');
  let dash = null;
  const i = raw.lastIndexOf(FENCE + 'json');
  if(i >= 0){ const rest = raw.slice(i + FENCE.length + 4); const end = rest.indexOf(FENCE); if(end >= 0){ try{ dash = JSON.parse(rest.slice(0, end).trim()); }catch(e){} } }
  if(!dash){ try{ dash = JSON.parse(raw); }catch(e){} }   // на случай чистого json без fence
  if(!dash || !Array.isArray(dash.cards)) throw new Error('Не удалось разобрать дашборд');
  return { dash, cost: aiCost(j) };
}

// ── Analyst target prices (FMP for US, Yahoo/Refinitiv consensus for EU/Nordic) ──
const TARGET_COL = 'Аналит. таргет';
const TARGET_RECENT_COL = 'Таргет 3м';   // свежий срез (последний квартал/месяц)
// Optional firm whitelist — only applied when env RESTRICT_FIRMS === '1'.
// Off by default: restricting to these would blank most Nordic/EU holdings.
const TARGET_FIRMS = new Set([
  // US coverage
  'kgi securities','fubon securities','gf securities','loop capital markets','evercore isi',
  'itau bba securities','oppenheimer','president capital management','craig-hallum','susquehanna',
  'new street research','benchmark co','bnp paribas','huatai research','aletheia capital',
  'ctbc securities','melius research','edgewater research','goldman sachs','d.a. davidson',
  'truist securities','jefferies','wedbush','keybanc capital markets','raymond james','banco safra',
  'cantor fitzgerald','mizuho securities','stifel','wells fargo','td cowen','seaport global',
  'barclays','summit insights group',
  // Nordic brokers — primary research houses for Swedish/Norwegian/Danish equities
  'seb','seb equities','handelsbanken','handelsbanken capital markets','carnegie','dnb carnegie',
  'nordea','nordea markets','dnb markets','abg sundal collier','pareto securities','danske bank',
  'sparebank 1 markets','arctic securities',
  // European banks covering EU large caps
  'kepler cheuvreux','berenberg','deutsche bank','ubs','morgan stanley','jp morgan','j.p. morgan',
  'jpmorgan','citigroup','citi','bofa securities','bank of america','hsbc','societe generale',
  'oddo bhf','exane bnp paribas','bernstein','rbc capital markets','santander',
].map(s => s.toLowerCase()));

// Yahoo (Refinitiv/LSEG) consensus — aggregates exactly those brokers' targets for
// EU/Nordic tickers FMP can't price. targetMeanPrice is in the stock's TRADING
// currency, so it's directly comparable to the dashboard's price column.
async function yahooTarget(sym){
  const qs = await yQuoteSummary(sym, 'financialData');
  const fd = qs && qs.financialData;
  const avg = yRaw(fd?.targetMeanPrice);
  return (typeof avg === 'number' && avg > 0)
    ? { avg: round2(avg), count: yRaw(fd?.numberOfAnalystOpinions) || 0, src: 'yahoo' }
    : null;
}

const sleep = ms => new Promise(res => setTimeout(res, ms));
// Average analyst target for one symbol (FMP "stable" API).
// Returns { avg, count } on success, or { err } describing why it couldn't.
//  • default: FMP's pre-computed last-quarter (~3-month) average (price-target-summary)
//  • RESTRICT_FIRMS=1: average per-analyst targets from the last 90 days, whitelisted firms only
async function fmpTarget(symbol, env){
  try{
    if(env.RESTRICT_FIRMS === '1'){
      const r = await fetch(`https://financialmodelingprep.com/stable/price-target-news?symbol=${encodeURIComponent(symbol)}&page=0&limit=100&apikey=${env.FMP_KEY}`);
      if(!r.ok) return { err: 'http ' + r.status };
      const arr = await r.json();
      if(!Array.isArray(arr)) return { err: 'bad json' };
      const cutoff = Date.now() - 90 * 24 * 3600 * 1000, vals = [];
      for(const x of arr){
        const t = Date.parse(x.publishedDate || x.date);
        if(isNaN(t) || t < cutoff) continue;
        if(!TARGET_FIRMS.has(String(x.analystCompany || '').toLowerCase())) continue;
        if(typeof x.priceTarget === 'number' && x.priceTarget > 0) vals.push(x.priceTarget);
      }
      return vals.length ? { avg: round2(vals.reduce((a, b) => a + b, 0) / vals.length), count: vals.length } : { err: 'no recent (firms)' };
    }
    const r = await fetch(`https://financialmodelingprep.com/stable/price-target-summary?symbol=${encodeURIComponent(symbol)}&apikey=${env.FMP_KEY}`);
    if(!r.ok) return { err: 'http ' + r.status };
    const arr = await r.json();
    const d = Array.isArray(arr) ? arr[0] : arr;
    if(!d) return { err: 'no data' };
    if(typeof d.lastQuarterAvgPriceTarget === 'number' && d.lastQuarterAvgPriceTarget > 0)
      return { avg: round2(d.lastQuarterAvgPriceTarget), count: d.lastQuarter ?? d.lastQuarterCount ?? 0 };
    if(typeof d.lastMonthAvgPriceTarget === 'number' && d.lastMonthAvgPriceTarget > 0)
      return { avg: round2(d.lastMonthAvgPriceTarget), count: d.lastMonth ?? d.lastMonthCount ?? 0 };
    return { err: 'no recent target' };
  }catch(e){ return { err: 'exc ' + String(e.message || '').slice(0, 24) }; }
}
// Полная картина по таргету из FMP price-target-summary: all-time консенсус
// ПЛЮС свежий срез (последний квартал, иначе последний месяц) — чтобы устаревшее
// среднее за всё время можно было сверить с актуальными таргетами.
// Возвращает { avg, count, recent, recentCount, recentSpan('q'|'m'), src }, или null.
async function fmpTargetFull(symbol, env){
  try{
    if(!env.FMP_KEY) return null;
    const r = await fetch(`https://financialmodelingprep.com/stable/price-target-summary?symbol=${encodeURIComponent(symbol)}&apikey=${env.FMP_KEY}`);
    if(!r.ok) return null;
    const arr = await r.json();
    const d = Array.isArray(arr) ? arr[0] : arr;
    if(!d) return null;
    const pos = v => (typeof v === 'number' && v > 0) ? v : null;
    const all = pos(d.allTimeAvgPriceTarget);
    const allN = d.allTimeCount ?? d.allTime ?? 0;
    let rec = null, recN = 0, span = null;
    if(pos(d.lastQuarterAvgPriceTarget)){ rec = d.lastQuarterAvgPriceTarget; recN = d.lastQuarterCount ?? d.lastQuarter ?? 0; span = 'q'; }
    else if(pos(d.lastMonthAvgPriceTarget)){ rec = d.lastMonthAvgPriceTarget; recN = d.lastMonthCount ?? d.lastMonth ?? 0; span = 'm'; }
    const avg = all ?? rec;            // если allTime пуст — основным становится свежий
    if(avg == null) return null;
    return { avg: round2(avg), count: all ? allN : recN,
             recent: rec != null ? round2(rec) : null, recentCount: recN, recentSpan: span, src: 'fmp' };
  }catch(e){ return null; }
}

// ── 🎯 A.1 Агрегация аналитических таргетов (консенсус + диапазон + рейтинги + изменения) ──
// Чистая функция из сырых ответов FMP — покрыта тестом. nowMs — для окна свежести 30д.
function aggTargets(sm, news, gc, nowMs){
  const pos = v => (typeof v === 'number' && v > 0) ? v : null;
  const consensusAll = pos(sm && sm.allTimeAvgPriceTarget);
  const lastQ = pos(sm && sm.lastQuarterAvgPriceTarget);
  const lastM = pos(sm && sm.lastMonthAvgPriceTarget);
  const consensus = lastQ != null ? lastQ : (lastM != null ? lastM : consensusAll);
  const span = lastQ != null ? 'q' : (lastM != null ? 'm' : 'all');
  const arr = Array.isArray(news) ? news.filter(x => x && typeof x.priceTarget === 'number' && x.priceTarget > 0) : [];
  const vals = arr.map(x => x.priceTarget);
  const high = vals.length ? Math.max.apply(null, vals) : null;
  const low  = vals.length ? Math.min.apply(null, vals) : null;
  const dts = arr.map(x => Date.parse(x.publishedDate || x.date)).filter(t => !isNaN(t));
  const lastDate = dts.length ? new Date(Math.max.apply(null, dts)).toISOString().slice(0,10) : null;
  const cutoff = nowMs - 30*864e5;
  const changes = arr.filter(x => { const t = Date.parse(x.publishedDate || x.date); return !isNaN(t) && t >= cutoff; })
    .sort((a,b) => Date.parse(b.publishedDate||b.date) - Date.parse(a.publishedDate||a.date))
    .slice(0, 12)
    .map(x => ({ firm: String(x.analystCompany || x.analystName || '').slice(0,42),
                 to: round2(x.priceTarget),
                 from: (typeof x.priceWhenPosted === 'number' && x.priceWhenPosted > 0) ? round2(x.priceWhenPosted) : null,
                 date: String(x.publishedDate || x.date || '').slice(0,10) }));
  const count = arr.length || (sm && (sm.lastQuarterCount != null ? sm.lastQuarterCount : sm.allTimeCount)) || 0;
  const g = Array.isArray(gc) ? gc[0] : gc;
  const gnum = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
  const ratings = g ? { strongBuy:gnum(g.strongBuy), buy:gnum(g.buy), hold:gnum(g.hold), sell:gnum(g.sell), strongSell:gnum(g.strongSell), consensus: g.consensus || null } : null;
  if(consensus == null && !arr.length) return null;
  return { consensus: consensus != null ? round2(consensus) : null, span,
           high: high != null ? round2(high) : null, low: low != null ? round2(low) : null,
           count, lastDate, ratings, changes, src: 'fmp',
           allTime: consensusAll != null ? round2(consensusAll) : null, lastQuarter: lastQ != null ? round2(lastQ) : null };
}
// Fallback Yahoo financialData (покрывает EU/Nordic, где FMP пусто): консенсус +
// диапазон + число аналитиков + распределение рейтингов (recommendationTrend).
async function targetsYahoo(symbol){
  try{
    const qs = await yQuoteSummary(symbol, 'financialData,recommendationTrend');
    const fd = qs && qs.financialData;
    const mean = fd && yRaw(fd.targetMeanPrice);
    if(!(mean > 0)) return null;
    const high = yRaw(fd.targetHighPrice), low = yRaw(fd.targetLowPrice), n = yRaw(fd.numberOfAnalystOpinions);
    const tr = qs.recommendationTrend && qs.recommendationTrend.trend && qs.recommendationTrend.trend[0];
    const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
    const ratings = tr ? { strongBuy:num(tr.strongBuy), buy:num(tr.buy), hold:num(tr.hold), sell:num(tr.sell), strongSell:num(tr.strongSell), consensus: (fd.recommendationKey || null) } : null;
    return { consensus: round2(mean), span: 'live',
             high: high > 0 ? round2(high) : null, low: low > 0 ? round2(low) : null,
             count: n || 0, lastDate: null, ratings, changes: [], src: 'yahoo', allTime: null, lastQuarter: null };
  }catch(e){ return null; }
}
async function targetsFull(symbol, env){
  // 1) FMP (US — диапазон + изменения за 30д + рейтинги)
  let agg = null;
  if(env.FMP_KEY){
    const k = env.FMP_KEY, s = encodeURIComponent(symbol), base = 'https://financialmodelingprep.com/stable';
    const get = async u => { try{ const r = await fetch(u); if(!r.ok) return null; return await r.json(); }catch(e){ return null; } };
    const [sm, news, gc] = await Promise.all([
      get(`${base}/price-target-summary?symbol=${s}&apikey=${k}`).then(a => Array.isArray(a) ? a[0] : a),
      get(`${base}/price-target-news?symbol=${s}&page=0&limit=50&apikey=${k}`),
      get(`${base}/grades-consensus?symbol=${s}&apikey=${k}`),
    ]);
    try{ agg = aggTargets(sm, news, gc, Date.now()); }catch(e){ agg = null; }
  }
  if(agg && agg.consensus != null) return agg;
  // 2) Fallback Yahoo (EU/Nordic, где у FMP нет таргетов)
  return (await targetsYahoo(symbol)) || agg;
}

// ── 📐 Valuation Check: текущие мультипликаторы (Yahoo) + историческая медиана (FMP) ──
// Yahoo покрывает US и Nordic/EU, поэтому он основной для живых мультипликаторов;
// Finnhub /stock/metric — US-only, поэтому не используется. P/E n/a при EPS≤0,
// EV/EBITDA n/a при EBITDA<0, PEG n/a при росте≤0 — отрицательные значения отсекаем.
async function yValuation(sym){
  const qs = await yQuoteSummary(sym, 'summaryDetail,defaultKeyStatistics,assetProfile');
  if(!qs) return null;
  const sd = qs.summaryDetail || {}, ks = qs.defaultKeyStatistics || {}, ap = qs.assetProfile || {};
  const pos = v => { const n = yRaw(v); return (typeof n === 'number' && isFinite(n) && n > 0) ? round2(n) : null; };
  return {
    pe: pos(sd.trailingPE),
    fwdPe: pos(sd.forwardPE),
    ps: pos(sd.priceToSalesTrailing12Months),
    evEbitda: pos(ks.enterpriseToEbitda),
    peg: pos(ks.pegRatio) ?? pos(ks.trailingPegRatio),
    sector: ap.sector || null,
    industry: ap.industry || null,
  };
}
// Историческая медиана мультипликаторов самой бумаги за 3 и 5 лет (FMP annual ratios).
// FMP покрывает в основном US; для Nordic вернётся null (в карточке — «нет истории»).
async function fmpRatiosHist(sym, env){
  try{
    if(!env.FMP_KEY) return null;
    const r = await fetch(`https://financialmodelingprep.com/stable/ratios?symbol=${encodeURIComponent(sym)}&period=annual&limit=5&apikey=${env.FMP_KEY}`);
    if(!r.ok) return null;
    const arr = await r.json();
    if(!Array.isArray(arr) || !arr.length) return null;   // newest first
    const pick = (row, keys) => { for(const k of keys){ const v = row[k]; if(typeof v === 'number' && isFinite(v) && v > 0) return v; } return null; };
    const series = keys => arr.map(row => pick(row, keys)).filter(v => v != null);
    const med = a => { if(!a.length) return null; const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return round2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2); };
    const pe = series(['priceToEarningsRatio', 'priceEarningsRatio', 'peRatio']);
    const ps = series(['priceToSalesRatio', 'priceSalesRatio']);
    const ev = series(['enterpriseValueMultiple', 'evToEbitda', 'enterpriseValueOverEBITDA']);
    if(!pe.length && !ps.length && !ev.length) return null;
    return {
      pe3: med(pe.slice(0, 3)), pe5: med(pe.slice(0, 5)),
      ps3: med(ps.slice(0, 3)), ps5: med(ps.slice(0, 5)),
      ev3: med(ev.slice(0, 3)), ev5: med(ev.slice(0, 5)),
    };
  }catch(e){ return null; }
}
// Резерв AI-портфеля в таблице ai_state: клиенты её не трогают (RLS без
// политик, доступ только у service-роли). Пока SQL не выполнен — try/catch
// и фолбэк на snap.aiPortBak.
async function loadBak(env, userId){
  try{
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/ai_state?user_id=eq.${userId}&select=port`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
    if(!r.ok) return null;
    const rows = await r.json();
    return (rows && rows[0] && rows[0].port) || null;
  }catch(e){ return null; }
}
// 💾 Durable-якорь в ai_state (отдельная таблица, без optimistic-concurrency
// guard → коммитится надёжно). Возвращает true, только если запись подтверждена
// (используется как сигнал «состояние сохранено» перед Telegram). false, если
// таблицы нет / сеть упала — тогда резерв в snap.aiPortBak продолжает работать.
async function saveBak(env, userId, ap){
  try{
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/ai_state`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, port: ap, updated_at: new Date().toISOString() }),
    });
    return !!(r && r.ok);
  }catch(e){ return false; }
}
async function loadRow(env){
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/ledger_state?select=user_id,data&order=updated_at.desc&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
  if(!r.ok) throw new Error('Supabase read failed: ' + r.status);
  const row = (await r.json())?.[0];
  return row ? { userId: row.user_id, snap: row.data } : null;
}
// rev, который запишет writeRow поверх данного снапшота (на 1 больше текущего).
function nextRev(snap){ return (Number(snap && snap.rev) || 0) + 1; }
// Детект коммита по вернувшейся (return=representation) строке: БД-триггер при
// rev-конфликте делает `return OLD` и PATCH отдаёт 204/строку со СТАРЫМ rev.
// Коммит прошёл ⇔ rev вернувшейся строки равен тому, что мы записали.
function writeCommitted(rows, expectedRev){
  const row = Array.isArray(rows) ? rows[0] : rows;
  const rev = row && row.data && Number(row.data.rev);
  return rev === expectedRev;
}
// Слить клиентские (редактируемые на сайте) настройки aiPort из свежего снапшота
// в наше торговое состояние. Применяется при каждом повторе RMW — настройки
// могли поменяться, торговое состояние остаётся нашим.
function mergeAiPortSettings(ap, fap, keys){
  fap = fap || {};
  keys.forEach(k => { if(fap[k] !== undefined) ap[k] = fap[k]; });
  return ap;
}
// Клиентские настройки aiPort, которые торговый цикл НЕ трогает (берёт из ledger).
const AIPORT_RUN_SETTINGS = ['strategy', 'intervalMin', 'commissionPct', 'minTradeSEK', 'enabled', 'startCapital', 'startedAt', 'myStartEquity', 'myStartLive'];
// PATCH ledger_state с детектом коммита. Возвращает true ⇔ запись реально
// закоммичена (rev вырос), false ⇔ rev-конфликт/откат триггером или ошибка сети.
// Все существующие вызовы игнорируют результат — обратная совместимость сохранена.
async function writeRow(env, userId, snap){
  const KEY = env.SUPABASE_SERVICE_KEY;
  // Инкрементим rev — иначе БД-триггер optimistic-concurrency отклонит запись
  // воркера (rev не вырос). Так серверные изменения (AI-портфель/алерты) проходят.
  const expectedRev = nextRev(snap);
  const data = { ...snap, rev: expectedRev };
  try{
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/ledger_state?user_id=eq.${userId}&select=data`, {
      method: 'PATCH',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
    });
    if(!r || !r.ok) return false;
    const rows = await r.json();
    return writeCommitted(rows, expectedRev);
  }catch(e){ return false; }
}
// Read-modify-write для aiPort с повтором при rev-конфликте. applyFn(snap)
// накладывает наше состояние на СВЕЖИЙ снапшот (клиент перенимает серверный
// aiPort — конфликты идут от записи клиентом ДРУГИХ частей, повторное наложение
// безопасно). Возвращает true ⇔ ledger закоммичен.
async function writeAiPortChecked(env, applyFn, opts){
  const tries = (opts && opts.tries) || 3;
  for(let i = 0; i < tries; i++){
    const fresh = await loadRow(env);
    if(!fresh) return false;
    applyFn(fresh.snap);
    if(await writeRow(env, fresh.userId, fresh.snap)) return true;
    await sleep(150 * (i + 1));
  }
  return false;
}
// 🤝 Примирение состояния AI-портфеля: «настоящее» = более СВЕЖЕЕ из ledger_state.aiPort
// и резерва ai_state (по поколению startedAt → затем lastRunAt → затем объёму журнала).
// Если победил резерв (клиент затёр сделки воркера) — пишем его обратно в ledger, сохраняя
// клиентские НАСТРОЙКИ. Возвращает авторитетное состояние. Чинит «застрявшее» расхождение.
const AIPORT_SETTINGS = ['strategy', 'intervalMin', 'commissionPct', 'minTradeSEK', 'enabled', 'startCapital', 'myStartEquity', 'myStartLive'];
async function aiPortAuthoritative(env){
  const row = await loadRow(env);
  if(!row) return null;
  const led = (row.snap && row.snap.aiPort) || null;
  const bak = (await loadBak(env, row.userId)) || (row.snap && row.snap.aiPortBak) || null;
  const sc = s => (s && s.startedAt) ? [s.startedAt || 0, s.lastRunAt || 0, (s.trades || []).length] : null;
  const a = sc(led), b = sc(bak);
  const bNewer = b && (!a || b[0] > a[0] || (b[0] === a[0] && (b[1] > a[1] || (b[1] === a[1] && b[2] > a[2]))));
  let best = bNewer ? bak : led;
  if(!best || !best.startedAt) return led || bak || null;
  if(best === bak && bNewer){
    // Резерв новее → ledger затёрли. Восстанавливаем, оставляя клиентские настройки из ledger.
    try{
      const fresh = await loadRow(env);
      if(fresh){
        const fap = (fresh.snap && fresh.snap.aiPort) || {};
        const merged = JSON.parse(JSON.stringify(best));
        AIPORT_SETTINGS.forEach(k => { if(fap[k] !== undefined && (fap.startedAt || 0) >= (merged.startedAt || 0)) merged[k] = fap[k]; });
        fresh.snap.aiPort = merged;
        fresh.snap.aiPortBak = JSON.parse(JSON.stringify(merged));
        await writeRow(env, fresh.userId, fresh.snap);
        await saveBak(env, fresh.userId, merged);
        return merged;
      }
    }catch(e){}
  }
  return best;
}
// Add the target column if missing, fill it (FMP → Yahoo consensus fallback for
// EU/Nordic tickers) on BOTH portfolio tabs, and persist back to Supabase.
async function updateTargets(env){
  const row = await loadRow(env);
  const tabsOf = snap => [PF_KEY, PF3_KEY].map(k => snap && snap.data && snap.data[k]).filter(Boolean);
  const tabs = tabsOf(row && row.snap);
  if(!tabs.length) return { updated: 0, total: 0 };
  // Этап 1: медленно собираем таргеты в кэш (rate-limit FMP — 250мс на тикер).
  const cache = {};   // sym → result, shared across tabs (3.0 mirrors 2.0 holdings)
  const details = [];
  for(const pf of tabs){
    for(const r of pf.rows){
      const sym = exSymbol(r[2], r[8]);
      if(cache[sym] !== undefined) continue;
      let res = await fmpTargetFull(sym, env);   // FMP: all-time + свежий срез
      if(!(res && typeof res.avg === 'number')){
        const y = await yahooTarget(sym);   // EU/Nordic → Yahoo/Refinitiv consensus (только avg)
        if(y) res = y;
      }
      cache[sym] = res;
      if(res && typeof res.avg === 'number') details.push(`✓ ${r[2]} (${sym}) → ${res.avg} · ${res.count} an.${res.src ? ' · ' + res.src : ''}`);
      else details.push(`— ${r[2]} (${sym}) [${(res && res.err) || '?'}]`);
      await sleep(250);   // stay under FMP's burst rate limit
    }
  }
  // Этап 2: перечитываем строку и пишем в СВЕЖИЙ снапшот — за минуты сбора
  // клиент мог сохранить свои изменения, их нельзя затирать старой копией.
  const fresh = await loadRow(env) || row;
  let updated = 0, total = 0, changed = false;
  for(const pf of tabsOf(fresh.snap)){
    let ti = pf.headers.indexOf(TARGET_COL);
    if(ti === -1){ pf.headers.push(TARGET_COL); ti = pf.headers.length - 1; changed = true; }
    let tri = pf.headers.indexOf(TARGET_RECENT_COL);
    if(tri === -1){ pf.headers.push(TARGET_RECENT_COL); tri = pf.headers.length - 1; changed = true; }
    pf.rows.forEach(r => { while(r.length < pf.headers.length) r.push(''); });
    for(const r of pf.rows){
      total++;
      const res = cache[exSymbol(r[2], r[8])];
      if(res && typeof res.avg === 'number'){
        r[ti] = res.avg; updated++; changed = true;
        if(typeof res.recent === 'number') r[tri] = res.recent;
      }
    }
  }
  if(changed) await writeRow(env, fresh.userId, fresh.snap);
  return { updated, total, details };
}


// Точечные алерты по уровням акций (🟢/🔴/📡 у SMA/поддержки/сопротивления) —
// УДАЛЕНЫ намеренно (2026-06-24): в Telegram теперь летят ТОЛЬКО действия
// AI-портфеля (🤖 покупка/продажа) и авто-анализ реальных портфелей (📈).
// Состояние акций смотрим на сайте, не в Telegram.
export default {
  // Cron — только действия AI-портфеля + авто-анализ реальных портфелей.
  // Точечные алерты по уровням акций убраны (спам о состоянии акций).
  // Цикл AI-портфеля и авто-анализ — ПОСЛЕДОВАТЕЛЬНО: оба делают
  // read-modify-write ledger_state.data, параллельно затёрли бы.
  async scheduled(event, env, ctx){
    ctx.waitUntil((async () => {
      await aiPortfolioRun(env, false).catch(() => {});       // гейт intervalMin внутри
      await runPortfolioAnalyses(env, false).catch(() => {}); // гейт pfAnalysisAt внутри
    })());
  },
  // GET ?symbols=AAPL,INVE-B.ST  → live prices (powers the dashboard's 🔄 Цены, US + Nordic/EU).
  // GET ?history=MU               → 2y daily closes (powers the dashboard's chart popup).
  // GET ?action=chart            → send the CHART_TICKER chart photo to Telegram now (manual test).
  // GET with no query             → run the alert report now (manual test).
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    if(request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if(url.searchParams.get('action') === 'version'){
      // Живой статус торговых сессий — мгновенная проверка «часов» worker'а.
      const mkts = Object.keys(MARKET_HOURS).map(c => {
        const loc = new Intl.DateTimeFormat('en-GB', { timeZone: MARKET_HOURS[c].tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
        return `${c} ${loc} ${marketOpen(c) ? 'ОТКРЫТ' : 'закрыт'}`;
      }).join('\n');
      return txt(`worker-build ${WORKER_BUILD}\nфичи: aiport · market-hours · recoVerdict · stockai(web) · insider(US+SE) · targets · valuation · reco · dashboard · live-futures(AI) · prepost · pf-prepost · models(per-feature)\n\nМодели:\n${Object.entries(MODELS).map(([k,v])=>`• ${k}: ${v}`).join('\n')}\n\nРынки сейчас:\n${mkts}`);
    }
    if(url.searchParams.get('action') === 'targets'){
      const dbg = url.searchParams.get('debug');   // ?action=targets&debug=NVDA → raw FMP reply
      if(dbg){
        const fr = await fetch(`https://financialmodelingprep.com/stable/price-target-summary?symbol=${encodeURIComponent(dbg)}&apikey=${env.FMP_KEY}`);
        return txt(`FMP HTTP ${fr.status}\n\n` + await fr.text());
      }
      try{ const t = await updateTargets(env); return txt(`Targets updated: ${t.updated}/${t.total}\n\n${(t.details || []).join('\n')}`); }
      catch(e){ return txt('Error: ' + e.message, 500); }
    }
    if(url.searchParams.get('action') === 'ai'){
      // POST: portfolio snapshot JSON → Claude analysis → {text} (Портфель 3.0 «AI Assistant»).
      if(!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY не задан — добавьте Secret в настройках worker' }, 500);
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{
        const snapshot = await request.json();
        // Фоновый режим: клиент прислал jobId → считаем в ctx.waitUntil, результат пишем
        // в ai_jobs, клиент опрашивает. Длинные прогоны больше не держат соединение.
        if(snapshot && snapshot.jobId){
          aiJobStart(ctx, env, adm.uid, snapshot.jobId, 'ai', snapshot.portfolioKey, () => aiAnalyze(env, snapshot));
          return json({ queued: true, jobId: snapshot.jobId });
        }
        return streamJson(() => aiAnalyze(env, snapshot));   // legacy: стрим без фонового режима
      }catch(e){
        return json({ error: String(e.message || e) }, 500);
      }
    }
    if(url.searchParams.get('action') === 'chat'){
      // POST: {messages, prefs, snapshot} → Claude chat reply + new memory rules.
      if(!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY не задан — добавьте Secret в настройках worker' }, 500);
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{ const b = await request.json(); return streamJson(() => aiChat(env, b)); }
      catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'insider'){
      // POST {items:[{tk,name,ccy}] | symbols:[...], from, to, windowDays}: батч сводок.
      // US (Finnhub, нужен FINNHUB_KEY) + SE/Nordic в SEK (Finansinspektionen, без ключа).
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{
        const body = await request.json();
        const items = (Array.isArray(body.items) ? body.items
            : (Array.isArray(body.symbols) ? body.symbols : []).map(s => ({ tk: s })))
          .slice(0, 25)
          .map(x => ({ tk: String(x.tk || '').trim().toUpperCase(), name: String(x.name || '').trim(), ccy: String(x.ccy || '').trim().toUpperCase() }))
          .filter(x => x.tk);
        const today = new Date().toISOString().slice(0, 10);
        const from = body.from || new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
        const to = body.to || today;
        const out = {};
        for(let i = 0; i < items.length; i += 8){
          const chunk = items.slice(i, i + 8);
          await Promise.all(chunk.map(async it => {
            const swedish = it.ccy === 'SEK' || /\.ST$/i.test(it.tk);
            let r, src, valCcy;
            if(swedish){ r = await fiInsider(fiIssuer(it.name || it.tk), from, to); src = 'fi'; valCcy = 'SEK'; }
            else if(env.FINNHUB_KEY){ r = await finnhubInsider(it.tk, from, to, env.FINNHUB_KEY); src = 'finnhub'; valCcy = 'USD'; }
            else { r = { err: 'no-key' }; src = 'finnhub'; valCcy = 'USD'; }
            out[it.tk] = r.err ? { err: r.err, src } : { ...insiderAggregate(r.data, body.windowDays), from, to, at: new Date().toISOString(), src, valCcy };
          }));
          if(i + 8 < items.length) await sleep(300);
        }
        return json(out);
      }catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    // insidernotify / valnotify / scnnotify (🕵 cluster buy / 📐 недооценка /
    // 📊 сценарий) удалены 2026-06-24 — это «сигналы о состоянии акций», смотрим
    // их на сайте. В Telegram остаются только действия AI-портфеля.
    if(url.searchParams.get('action') === 'valuation'){
      // POST {symbols:[биржевые символы]}: батч мультипликаторов + историческая медиана.
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{
        const body = await request.json();
        const syms = (Array.isArray(body.symbols) ? body.symbols : []).slice(0, 18).map(s => String(s).trim()).filter(Boolean);
        const out = {};
        // Чанк по 6 (2 подзапроса/символ: Yahoo + FMP) — щадим лимиты.
        for(let i = 0; i < syms.length; i += 6){
          const chunk = syms.slice(i, i + 6);
          await Promise.all(chunk.map(async s => {
            const [val, hist] = await Promise.all([yValuation(s), fmpRatiosHist(s, env)]);
            out[s] = (val || hist) ? { ...(val || {}), hist: hist || null, at: new Date().toISOString() } : null;
          }));
          if(i + 6 < syms.length) await sleep(250);
        }
        return json(out);
      }catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'targetsagg'){
      // POST {symbols}: A.1 — агрегированные аналит. таргеты (консенсус/диапазон/рейтинги/изменения).
      // ВАЖНО: имя 'targetsagg', т.к. 'targets' уже занят debug-роутом updateTargets выше (txt без CORS).
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{
        const body = await request.json();
        const syms = (Array.isArray(body.symbols) ? body.symbols : []).slice(0, 18).map(s => String(s).trim()).filter(Boolean);
        const out = {};
        // Чанк по 5 (3 подзапроса/символ: summary + news + grades) — щадим лимиты.
        for(let i = 0; i < syms.length; i += 5){
          const chunk = syms.slice(i, i + 5);
          await Promise.all(chunk.map(async s => { out[s] = await targetsFull(s, env); }));
          if(i + 5 < syms.length) await sleep(250);
        }
        return json(out);
      }catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'stockai'){
      if(!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY не задан' }, 500);
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{ const b = await request.json(); return streamJson(() => stockAnalyze(env, b)); }
      catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'dashboard'){
      // POST снапшот портфеля → AI Proto формирует карточки дашборда (web_search).
      if(!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY не задан' }, 500);
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{
        const b = await request.json();
        if(b && b.jobId){
          aiJobStart(ctx, env, adm.uid, b.jobId, 'dashboard', b.portfolioKey, () => dashboardGen(env, b));
          return json({ queued: true, jobId: b.jobId });
        }
        return streamJson(() => dashboardGen(env, b));
      }catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'reco'){
      // POST снапшот карточки → AI-Рекомендация (вердикт+разбор) с web_search.
      if(!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY не задан' }, 500);
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{ const b = await request.json(); return streamJson(() => recoAnalyze(env, b)); }
      catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'forecast'){
      // POST снапшот портфеля → AI-прогноз стоимости на 3 горизонта (web_search).
      if(!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY не задан' }, 500);
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{ const b = await request.json(); return streamJson(() => forecastGen(env, b)); }
      catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'playbook'){
      // 📚 AI подтягивает свежие лучшие практики → новые принципы плейбука (web_search).
      if(!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY не задан' }, 500);
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{ const b = await request.json(); return streamJson(() => playbookGen(env, b)); }
      catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'cyclemon'){
      // 🧭 POST {ticker,name,metrics,derived} → свежие статусы сигналов цикла памяти (web_search).
      if(!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY не задан' }, 500);
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{ const b = await request.json(); return streamJson(() => cycleGen(env, b)); }
      catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'aipreset'){
      // ♻️ Обнуление AI-портфеля (кнопка на вкладке 🤖, только админ).
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{ return json({ result: await aiPortfolioReset(env) }); }
      catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'aiport'){
      // Принудительный цикл AI-портфеля (кнопка «▶» на вкладке 🤖, только админ).
      // + авто-анализ реальных портфелей (Dima/Anna) → data[key].analysis.
      // Последовательно: оба пишут ledger_state.data.
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      // streamJson: цикл + 2 анализа Opus могут занять >100с — синхронный ответ
      // упёрся бы в таймаут Cloudflare (524), и запись анализа не успевала бы.
      // Сбой одного шага не должен ронять другой — оба независимы.
      return streamJson(async () => {
        let cycle = '', analysis = '';
        try{ cycle = await aiPortfolioRun(env, true); }catch(e){ cycle = 'цикл AI-портфеля: ошибка — ' + String((e && e.message) || e); }
        try{ analysis = await runPortfolioAnalyses(env, true); }catch(e){ analysis = 'анализ портфелей: ошибка — ' + String((e && e.message) || e); }
        return { result: cycle + '\n' + analysis };
      });
    }
    if(url.searchParams.get('action') === 'aiportstate'){
      // Авторитетное состояние AI-портфеля (примиряет ledger ↔ резерв ai_state) — для дисплея сайта.
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{ return json({ port: await aiPortAuthoritative(env) }); }
      catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'prompts'){
      // Список AI-промптов для админской кнопки «📜 Промпты» на дашборде —
      // единственный источник правды, тексты не дублируются на клиенте.
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      return json([
        { name: '🤖 AI Proto — анализ портфеля (AI_SYSTEM)',
          about: 'Главная модель. Кнопка «🔮 Проанализировать портфель» на вкладке AI Proto. Получает свежий снапшот: позиции с живыми ценами, уровни SMA/поддержки, таргеты, мультипликаторы, кэш и плечо, накопленные правила инвестора (investorRules) и рыночный контекст всех индексов (marketContext). Через web_search собирает свежие новости по позициям и кандидатам + глобальную макрокартину. Цель — обогнать OMXS30/Nasdaq 100/S&P 500. Возвращает отчёт (включая раздел «Обгон индексов») + машиночитаемый план ребалансировки для вкладки «Предложение».',
          text: AI_SYSTEM },
        { name: '🔥 Анализ индекса (WATCH_SYSTEM)',
          about: 'Кнопка анализа на индексных вкладках. Получает watchlist-снапшот: все акции с уровнями, фазами и сигналами. Выделяет 5–8 самых актуальных бумаг с действиями (Купить/Следить/Фиксировать/Избегать), сильные и слабые сектора, риски.',
          text: WATCH_SYSTEM },
        { name: '🤖 AI Портфель (AIPORT_SYSTEM)',
          about: 'Часовой цикл worker-крона. Получает виртуальный портфель (кэш, позиции с живыми ценами и P&L, журнал сделок), стратегию и вселенную всех акций дашборда. Возвращает торговые решения {action, ticker, qty, reason, trigger} — worker исполняет их по живым ценам и шлёт уведомления в Telegram.',
          text: AIPORT_SYSTEM },
        { name: '🔬 AI-анализ акции (STOCKAI_SYSTEM)',
          about: 'Кнопка «🤖 AI-анализ» в карточке акции. Снапшот бумаги + контекст портфеля + прошлые разборы; через web_search — свежие новости; возвращает разбор и рекомендацию по ТРЁМ горизонтам (Момент/6–9м/Лонг): действие, размер позиции, зоны входа, целевые цены и потенциал на каждый.',
          text: STOCKAI_SYSTEM },
        { name: '🔄 AI-Рекомендация (RECO_SYSTEM)',
          about: 'Кнопка «🔄 AI-Рекомендация» в карточке акции. Снапшот карточки (техника, фундаментал, оценка, контекст портфеля) + web_search свежих новостей и глобальной макрокартины; возвращает рекомендацию по ТРЁМ горизонтам (Момент/6–9м/Лонг): вердикт buy/wait/sell/avoid на каждый, зоны входа и таргеты. Верхний вердикт = «сейчас». Отдельно от детерминированного скоринга «Рекомендация».',
          text: RECO_SYSTEM },
        { name: '📊 AI-Dashboard (DASH_SYSTEM)',
          about: 'Кнопка «✨ Сгенерировать» на вкладке 📊 AI-Dashboard. AI Proto со снапшотом портфеля, правилами (память) и web_search свежих новостей/макро формирует карточки (состояние, что важно сегодня, возможности, риски, макро, диверсификация, план на неделю) и picks — лучшие рекомендации по акциям на 1–3 / 3–6 / 6–12 мес.',
          text: DASH_SYSTEM },
        { name: '💬 Чат AI Proto (CHAT_SYSTEM)',
          about: 'Диалог с AI Proto. Видит снапшот текущей вкладки и правила инвестора; отвечает кратко с конкретными уровнями. Извлекает из ваших сообщений устойчивые предпочтения и возвращает их в поле memory — так пополняется 🧠 память.',
          text: CHAT_SYSTEM },
      ]);
    }
    if(url.searchParams.get('action') === 'ydebug'){
      // Step-by-step Yahoo auth diagnostics: ?action=ydebug&sym=RHM.DE
      const sym = (url.searchParams.get('sym') || 'RHM.DE').trim();
      const lines = [];
      _yAuth = null;   // force a fresh auth round
      const a = await yAuth(m => lines.push(m));
      if(a){
        const r = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=financialData&crumb=${encodeURIComponent(a.crumb)}`,
          { headers: { ...Y_UA, Cookie: a.cookie } });
        lines.push(`quoteSummary(${sym}) status: ${r.status}`);
        lines.push('body: ' + (await r.text()).slice(0, 600));
      }else lines.push('yAuth FAILED — no cookie/crumb');
      return txt(lines.join('\n'));
    }
    if(url.searchParams.has('fundamentals')){
      // Balance / cash-flow / growth snapshot for one symbol (FMP) → Портфель 3.0 health cards.
      // Optional &period=quarter → latest quarterly balance + TTM cash flow / revenue.
      // Valuation (P/E, forward P/E, P/S) comes from Yahoo summaryDetail in parallel.
      const per = url.searchParams.get('period') === 'quarter' ? 'quarter' : 'annual';
      const sym = url.searchParams.get('fundamentals').trim().toUpperCase();
      const [f, qs] = await Promise.all([fundamentals(sym, env, per), yQuoteSummary(sym, 'summaryDetail')]);
      if(f && qs && qs.summaryDetail){
        const sd = qs.summaryDetail;
        f.pe = yRaw(sd.trailingPE);
        f.fwdPe = yRaw(sd.forwardPE);
        f.ps = yRaw(sd.priceToSalesTrailing12Months);
      }
      return json(f);
    }
    if(url.searchParams.has('profile')){
      // Company profile (name + sector) → auto-fill when adding a stock in Портфель 3.0.
      const qs = await yQuoteSummary(url.searchParams.get('profile').trim(), 'assetProfile,quoteType');
      const out = qs ? {
        name: qs.quoteType?.longName || qs.quoteType?.shortName || null,
        type: qs.quoteType?.quoteType || null,   // EQUITY | ETF | MUTUALFUND | …
        sector: qs.assetProfile?.sector || null,
        industry: qs.assetProfile?.industry || null,
        country: qs.assetProfile?.country || null,
      } : null;
      return json(out || {});
    }
    if(url.searchParams.has('calendar')){
      // Batch: next earnings date + dividend info per symbol → «Дивиденды и отчёты».
      const syms = url.searchParams.get('calendar').split(',').map(s => s.trim()).filter(Boolean);
      const out = {};
      await Promise.all(syms.map(async s => { out[s] = await calendarInfo(s); }));
      return json(out);
    }
    if(url.searchParams.has('earnings')){
      // Next earnings date + consensus estimates (FMP) → Портфель 3.0 «Ближайший отчёт».
      const e = await earningsInfo(url.searchParams.get('earnings').trim().toUpperCase(), env);
      return json(e || { next: null, last: null });
    }
    if(url.searchParams.has('targets')){
      // Batch: analyst consensus target + valuation extras (P/E, P/S, dividend
      // yield) in ONE quoteSummary call per symbol → fills «Аналит. таргет» and
      // the optional list columns on the dashboard.
      const syms = url.searchParams.get('targets').split(',').map(s => s.trim()).filter(Boolean);
      const out = {};
      await Promise.all(syms.map(async s => {
        // Основной таргет — FMP (all-time консенсус + свежий срез за квартал/месяц);
        // Yahoo даёт метрики оценки и служит фолбэком для EU/Nordic, которых нет в FMP.
        const [qs, fmp] = await Promise.all([
          yQuoteSummary(s, 'financialData,summaryDetail,price'),
          fmpTargetFull(s, env),
        ]);
        if(!qs && !fmp){ out[s] = null; return; }
        const fd = (qs && qs.financialData) || {}, sd = (qs && qs.summaryDetail) || {}, pr = (qs && qs.price) || {};
        const pct = v => (typeof v === 'number' && isFinite(v)) ? round2(v * 100) : null;
        const yAvg = yRaw(fd.targetMeanPrice);
        let avg = null, count = 0, recent = null, recentCount = 0, recentSpan = null, src = null;
        if(fmp && typeof fmp.avg === 'number'){
          avg = fmp.avg; count = fmp.count; recent = fmp.recent; recentCount = fmp.recentCount; recentSpan = fmp.recentSpan; src = 'fmp';
        }else if(typeof yAvg === 'number' && yAvg > 0){
          avg = round2(yAvg); count = yRaw(fd.numberOfAnalystOpinions) || 0; src = 'yahoo';
        }
        out[s] = {
          avg, count, recent, recentCount, recentSpan, src,
          pe: yRaw(sd.trailingPE), ps: yRaw(sd.priceToSalesTrailing12Months),
          divy: yRaw(sd.dividendYield),
          // Метрики для классификации типов (по правилам MSCI/S&P/Morningstar):
          beta: yRaw(sd.beta),
          roe: pct(yRaw(fd.returnOnEquity)),                               // %
          de: yRaw(fd.debtToEquity) != null ? round2(yRaw(fd.debtToEquity) / 100) : null,   // Yahoo даёт в %
          revg: pct(yRaw(fd.revenueGrowth)),                               // % г/г
          payout: pct(yRaw(sd.payoutRatio)),                               // %
          rev: yRaw(fd.totalRevenue),                                      // TTM, валюта торгов
          cap: yRaw(pr.marketCap),                                         // капитализация
        };
      }));
      return json(out);
    }
    if(url.searchParams.has('options')){
      // Implied move из опционов (ATM-стрэддл ближайшей экспирации). Публичные данные.
      const im = await optionsImplied(url.searchParams.get('options').trim());
      return json(im || { error: 'no options' });
    }
    if(url.searchParams.has('news')){
      // 📰 Заголовки новостей Yahoo по тикеру (кэш 10 мин). Публичные данные.
      const nw = await stockNews(url.searchParams.get('news').trim());
      return json(nw || { error: 'no news' });
    }
    if(url.searchParams.has('levels')){
      // S/R уровни индексов (pivots + свинги). Кэш 10 мин; публичные данные.
      const syms = url.searchParams.get('levels').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
      const out = {};
      for(const s of syms){ try{ const lv = await levelsFor(s); if(lv) out[s] = lv; }catch(e){} }
      return json(out);
    }
    if(url.searchParams.has('history')){
      // Daily close series for one symbol → powers the dashboard's stock chart popup.
      // Optional &range= (e.g. 2y, 5y); defaults to 2y.
      const range = (url.searchParams.get('range') || '2y').trim();
      const h = await dailyHistory(url.searchParams.get('history').trim(), range);
      return json(h || { t: [], c: [] });
    }
    if(url.searchParams.get('action') === 'sectors'){
      // 🔄 Live Sector Tracker: доходность 11 GICS-секторов (ETF) vs SPY по периодам.
      return json(await sectorTracker().catch(e => ({ error: String(e.message || e), sectors: [] })));
    }
    if(url.searchParams.has('prepost')){
      // Pre/post-market: одна бумага (карточка) или несколько через запятую
      // (сводка портфеля) → карта {sym: {state,pre,post,...}}.
      const syms = url.searchParams.get('prepost').split(',').map(s => s.trim()).filter(Boolean);
      if(syms.length <= 1) return json(await prePost(syms[0] || '') || {});
      const out = {};
      await Promise.all(syms.map(async s => { out[s] = await prePost(s); }));
      return json(out);
    }
    if(url.searchParams.get('action') === 'chart'){
      // Manual test: send the CHART_TICKER chart photo to Telegram now.
      try{ const ok = await sendChartMU(env); return txt(ok ? `Chart sent ✓ (${CHART_TICKER})` : `No chart (${CHART_TICKER} not in portfolio or render failed)`); }
      catch(e){ return txt('Error: ' + e.message, 500); }
    }
    if(url.searchParams.has('symbols')){
      const syms = url.searchParams.get('symbols').split(',').map(s => s.trim()).filter(Boolean);
      const out = {};
      await Promise.all(syms.map(async s => {
        const q = await yahoo(s);
        if(q){ const w = await weeklySMA(s); if(w) Object.assign(q, w); }   // add sma50w/100w/200w (3-year view)
        out[s] = q;   // {price, pct, sma50/100/200, support, resistance, sma50w/100w/200w} | null
      }));
      return json(out);
    }
    // Точечные алерты по уровням удалены — ручного прогона больше нет.
    return txt(`worker-build ${WORKER_BUILD}\nTelegram: только действия AI-портфеля + авто-анализ портфелей.\nИспользуй ?action=version для статуса.`);
  },
};

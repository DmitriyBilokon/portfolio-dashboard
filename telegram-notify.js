// Cloudflare Worker — scheduled Telegram alerts for the Index Portfolio Dashboard.
//
// What it does (on a cron, even when the site is closed):
//   targeted per-stock alerts, near-realtime. Each run reads the portfolio
//   from Supabase, fetches live prices + levels from Yahoo and sends ONE
//   Telegram message PER STOCK when:
//     🟢 price is within ±1.5% of a buy level (SMA 50/100/200 / support)
//     🔴 price is within ±1.5% of resistance (take-profit zone)
//     📡 price is approaching a level (1.5–4% away)
//   A 24h cooldown per stock+signal (stored in the Supabase row) keeps a
//   frequent cron from spamming. Recommended cron: */10 6-22 * * 1-5.
//
// ── Setup (≈10 min, free) ───────────────────────────────────────────────
//  Bot:   message @BotFather → /newbot → copy the token.
//  Chat:  message @userinfobot → copy your numeric "Id".
//  Supabase service key: Project Settings → API → service_role (secret!).
//  Deploy: dash.cloudflare.com → Workers → Create → paste this → Deploy.
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

const WORKER_BUILD = '2026-06-14cost';   // ?action=version — проверить, что задеплоено
const PF3_KEY = '🚀 Портфель 3.0';   // portfolio of record
const PF_KEY = '💼 Портфель 2.0';    // legacy key — read fallback only
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
    const closes = (q.close || []).filter(v => typeof v === 'number' && v > 0);
    const lows = (q.low || []).filter(v => typeof v === 'number' && v > 0).slice(-SR_WINDOW);
    const highs = (q.high || []).filter(v => typeof v === 'number' && v > 0).slice(-SR_WINDOW);
    const price = m.regularMarketPrice;
    const prev = closes.length >= 2 ? closes[closes.length - 2] : (m.chartPreviousClose || m.previousClose);
    const pct = (prev && prev > 0) ? (price - prev) / prev * 100 : null;
    return {
      price, pct,
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
async function dailyHistory(sym, range = '2y'){
  const res = await yChart(sym, '1d', range);
  if(!res) return null;
  const ts = res.timestamp || [], cl = res.indicators?.quote?.[0]?.close || [];
  const t = [], c = [];
  for(let i = 0; i < cl.length; i++){ if(typeof cl[i] === 'number' && cl[i] > 0){ t.push(ts[i]); c.push(round2(cl[i])); } }
  return c.length ? { t, c } : null;
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
  return {
    period: qtrMode ? 'quarter' : 'annual',
    source: 'yahoo',
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
    get(`income-statement?symbol=${s}&limit=${qtr ? 5 : 6}${per}`),   // annual: up to 5y history · quarter: q0..q4 for YoY
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
  return {
    period: qtr ? 'quarter' : 'annual',
    source: 'fmp',
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
    if(ADMIN_EMAILS.includes(email)) return { ok:true, email };
    const q = await fetch(`${env.SUPABASE_URL}/rest/v1/user_access?user_id=eq.${u.id}&select=role`,
      { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
    const rows = q.ok ? await q.json() : [];
    if(rows[0] && rows[0].role === 'admin') return { ok:true, email };
    return { ok:false, error:'AI Proto доступен только администратору' };
  }catch(e){ return { ok:false, error:'Не удалось проверить доступ' }; }
}

// ── AI Assistant: portfolio analysis via the Claude API ─────────────────────
// The dashboard POSTs a portfolio snapshot (positions with live prices, SMA
// levels, support/resistance, analyst targets, cash/leverage); Claude returns a
// structured markdown report with sell/add/new-position recommendations.
const AI_SYSTEM = `Ты — AI Proto, главная и самая важная аналитическая модель этого инвестиционного дашборда. Ты — постоянно обучающийся портфельный управляющий частного инвестора из Швеции (базовая валюта — шведская крона, kr). Все прочие AI-функции дашборда вспомогательны; именно ты отвечаешь за стратегию портфеля.

ТВОЯ ГЛАВНАЯ ЗАДАЧА — добиться, чтобы портфель ОПЕРЕЖАЛ эталонные индексы (OMXS30, Nasdaq 100, S&P 500) по совокупной доходности на горизонте недель и месяцев. Просто повторить индекс недостаточно: ищи альфу — точки входа у уровней, фиксацию перегретых позиций, перевес сильных секторов и недооценённых качественных бумаг. Опережение достигается дисциплиной и качеством отбора, а не размером риска.

ДАННЫЕ. Тебе передают САМЫЙ СВЕЖИЙ снапшот портфеля и рынка, собранный дашбордом: живые цены, дневные изменения, технические уровни (SMA 50/100/200, поддержка, сопротивление), консенсус-таргеты аналитиков (и свежий срез), мультипликаторы, доли позиций, свободный кэш и кредитное плечо. Опирайся на эти переданные данные и свои знания о компаниях; цифры портфеля бери из снапшота, не выдумывай.

ЖИВЫЕ НОВОСТИ И МАКРО. ОБЯЗАТЕЛЬНО используй web_search, чтобы собрать самые свежие данные: новости по ключевым позициям портфеля и кандидатам на новые покупки (отчёты, гайденс, сделки M&A, рейтинги и таргеты аналитиков, регуляторика) и глобальную макрокартину (ставки ФРС/ЕЦБ/Riksbank, инфляция, геополитика, цены на сырьё и валюты, настроение по секторам и ведущим индексам). Учитывай найденное во всех разделах и рекомендациях; кратко ссылайся на самое важное.

ОБУЧЕНИЕ. Если есть investorRules — это твоя накопленная память (правила, риск-профиль и предпочтения инвестора): строго соблюдай их. Сверяй текущую картину с этими правилами и с прежними решениями; если прошлая логика не сработала — скорректируй подход и прямо скажи об этом. Ты учишься на результатах.

Дай структурированный анализ на русском языке в markdown строго по разделам:

## 📊 Ситуация в портфеле и на рынке
2–4 предложения: общее состояние (тренды позиций относительно SMA, концентрация, доля кэша) и где портфель сейчас относительно эталонных индексов.

## 🔴 Продать или сократить
Конкретные позиции с обоснованием (цена у сопротивления, превышение разумной доли, слабый тренд, цена выше таргета). Если кандидатов нет — так и скажи одной строкой.

## 🟢 Докупить
Какие позиции, на каких уровнях (используй переданные SMA/поддержку), какими частями от свободного кэша.

## ➕ Новые позиции
2–4 конкретные идеи (компания, тикер, биржа, почему, какую долю выделить) с учётом недостающих секторов и географии портфеля и того, что даст преимущество над индексами.

## 🆚 Обгон индексов
Чётко: чего портфелю не хватает относительно OMXS30 / Nasdaq 100 / S&P 500 (перевес/недовес секторов, гео, факторов) и как предложенные изменения должны дать опережение. Назови главный источник альфы на ближайший период.

## ⚠️ Риски
Главные 2–3 риска текущего портфеля.

## ✅ План действий
Нумерованный список конкретных шагов на ближайшие 2–4 недели с суммами в kr.

Правила: опирайся на переданные данные и свои знания о компаниях; называй конкретные цифры (уровни входа, доли, суммы); будь лаконичен — без воды; если есть marketContext — это живая статистика рыночных фаз по всем индексным вкладкам (Nasdaq 100, S&P 500, OMXS30, OMXSPI, DAX 40, CAC 40, FTSE MIB, OBX 25) и сводки их последних AI-обзоров: используй её как картину рынка (breadth, моментум); в конце отчёта одна строка: «Это аналитическая сводка, а не индивидуальная инвестиционная рекомендация.»

В САМОМ КОНЦЕ ответа добавь машиночитаемый план ребалансировки (он отображается на вкладке «Предложение») — fenced json, открой и закрой его символами ${FENCE} :
${FENCE}json
{"summary":"<2–3 предложения о целевой структуре, нацеленной на обгон индексов>","actions":[{"action":"Купить|Докупить|Сократить|Продать|Держать","name":"<компания>","ticker":"<тикер>","details":"<уровень входа/выхода и краткое обоснование>","amountSEK":<число или null>}]}
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
      required: ['summary', 'actions'],
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

Правила: опирайся на переданные данные и свои знания о компаниях; конкретные цифры и уровни; лаконично; если есть investorRules — строго учитывай их; в конце одна строка: «Это аналитическая сводка, а не индивидуальная инвестиционная рекомендация.»

Ответ верни строго в JSON по схеме: report — анализ в markdown; proposal — summary (1–2 предложения о состоянии индекса) и actions — те же 5–8 самых актуальных акций (action из списка: Купить/Докупить/Сократить/Продать/Держать — подбери ближайшее по смыслу; details: уровни и причина; amountSEK: null).`;

async function aiAnalyze(env, snapshot){
  const watch = !!(snapshot && snapshot.mode === 'watchlist');
  const system = watch ? WATCH_SYSTEM : AI_SYSTEM;
  const today = new Date().toISOString().slice(0, 10);
  const reqBody = {
    model: 'claude-opus-4-8',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: `Сегодня ${today}. Снапшот (JSON):\n${JSON.stringify(snapshot)}` }],
  };
  // Watchlist (индексы) — структурированный вывод. Портфель (AI Proto) — с web_search
  // по свежим новостям/макро, поэтому план ребалансировки приходит fenced-json.
  if(watch) reqBody.output_config = { format: { type: 'json_schema', schema: AI_SCHEMA } };
  else reqBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  if(!r.ok) throw new Error('Claude API ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
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
const CHAT_SYSTEM = `Ты — AI Proto, главная аналитическая модель инвестиционного дашборда частного инвестора из Швеции (базовая валюта — шведская крона, kr). Твоя сверхзадача — помогать портфелю опережать эталонные индексы (OMXS30, Nasdaq 100, S&P 500). В системном контексте тебе передают живой снапшот портфеля (позиции, цены, SMA 50/100/200, поддержка/сопротивление, консенсус-таргеты, кэш и плечо) и сохранённые «правила инвестора».

Отвечай на вопросы инвестора на русском языке, в markdown, кратко и по делу: конкретные цифры, уровни, доли и суммы в kr. Опирайся на снапшот, правила инвестора и свои знания о компаниях; не выдумывай данные, которых нет. Если вопрос про сделку — дай чёткую рекомендацию с обоснованием и уровнями.

Поле memory: если в ПОСЛЕДНЕМ сообщении инвестора есть новое устойчивое предпочтение или правило на будущее (риск-профиль, стратегия, ограничения, «всегда…», «никогда…», любимые сектора, целевые доли) — сформулируй каждое одной короткой фразой от третьего лица и верни в memory. Уже переданные правила не дублируй. Если нового нет — верни пустой список.`;

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
      model: 'claude-opus-4-8',
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: CHAT_SCHEMA } },
      system: CHAT_SYSTEM + '\n\n' + ctx,
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
const AIPORT_SYSTEM = `Ты — автономный портфельный управляющий ВИРТУАЛЬНОГО AI-портфеля на инвестиционном дашборде (paper trading, базовая валюта — шведская крона SEK). Тебе передают JSON: стратегия, кэш, стартовый капитал, позиции с живыми ценами и P&L, журнал последних сделок, курсы валют и вселенная доступных акций (формат строки — в universeLegend).

ЦЕЛЬ ПОРТФЕЛЯ — опережать эталонные индексы (OMXS30, Nasdaq 100, S&P 500) по совокупной доходности на горизонте месяцев. Просто повторить индекс недостаточно: ищи альфу — точки входа у уровней, фиксацию перегретых позиций, перевес сильных секторов; при этом не превращай портфель в казино — опережение должно достигаться дисциплиной, а не размером риска.

Управляй портфелем строго по стратегии: формируй позиции, докупай у уровней, фиксируй прибыль и убытки, ребалансируй по типам и секторам.

Правила:
- Торгуй ТОЛЬКО тикерами из universe или из своих позиций.
- Торгуй ТОЛЬКО бумагами, чей рынок сейчас ОТКРЫТ — смотри marketsOpen по валюте бумаги (true = биржа торгует). Решения по закрытым рынкам будут отклонены исполнением.
- qty — целое число акций; сумма сделки ≥ minTradeSEK; не покупай, если не хватает cashSEK.
- Держи кэш-резерв ≥5% от equity; одна позиция ≤15% equity, если стратегия не требует иного.
- Триггеры: цена у SMA 50/200 или поддержки при здоровом тренде — покупка/докупка; у сопротивления, выше таргета или при перегреве — фиксация; падающий нож и Спекулятивная без явного сетапа — избегать; стоп-дисциплина: позиция глубже −12% от средней без улучшения картины — сокращай.
- recoVerdict в universe — вердикт детерминированного скоринга сайта (фундаментал+техника+риск): учитывай его как ОДИН ИЗ факторов, не как приказ. Покупать бумаги с recoVerdict=wait или avoid МОЖНО — но только с объяснением: reason такой сделки ОБЯЗАН начинаться с «reco=wait: …» / «reco=avoid: …» и причины отступления (например «reco=wait: беру в ядро по квоте Качественных — фундаментал сильный, вход у SMA 50»). То же при продаже бумаги с recoVerdict=buy («reco=buy: фиксирую, потому что …»). ВАЖНО: исполнение АВТОМАТИЧЕСКИ ОТКЛОНЯЕТ сделку против вердикта, если reason не ссылается на него — сделка без объяснения просто не состоится. avoid покупай только при действительно сильном обосновании.
- БОЛЬШИНСТВО циклов не требуют сделок: нет явных сетапов — верни пустой decisions. Не торгуй ради торговли. Максимум 4 сделки за цикл.
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
      const tg = num(ix.tg);
      out.push([tk, ccy, String(r[4] || ''), String(r[5] || ''), price, parseFloat(r[10]) || 0,
        dist(num(ix.s50)), dist(num(ix.s200)), dist(num(ix.sup)), dist(num(ix.res)),
        (tg && tg > 0) ? Math.round((tg / price - 1) * 1000) / 10 : null,
        num(ix.pe), num(ix.beta), num(ix.roe), num(ix.revg),
        (ix.reco >= 0 && /^(buy|wait|sell|avoid)$/.test(String(r[ix.reco] || ''))) ? String(r[ix.reco]) : null]);
    }
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
    if(apEmpty && bakHas){
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
    strategy: ap.strategy || '',
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
  };
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
      model: 'claude-opus-4-8',
      max_tokens: 6000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: AIPORT_SCHEMA } },
      system: AIPORT_SYSTEM,
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
  for(const dec of parsed.decisions.slice(0, 4)){
    const tk = String(dec.ticker || '').trim().toUpperCase();
    const qty = Math.floor(Math.abs(parseFloat(dec.qty) || 0));
    if(!tk || !(qty > 0)){ skipped.push(`${tk || '?'}: некорректное решение`); continue; }
    if(dec.action === 'sell'){
      const p = positions.find(x => String(x.ticker).toUpperCase() === tk);
      if(!p){ skipped.push(`sell ${tk}: нет позиции`); continue; }
      if(!marketsOpen[String(p.ccy).toUpperCase()]){ skipped.push(`sell ${tk}: рынок ${p.ccy} закрыт`); continue; }
      if(recoBy[tk] === 'buy' && !mentionsReco(dec.reason)){ skipped.push(`sell ${tk}: reco=buy, в reason нет объяснения отступления`); continue; }
      const q = quotes[p.ticker] || await yahoo(exSymbol(p.ticker, p.ccy));
      if(!(q && q.price > 0)){ skipped.push(`sell ${tk}: нет котировки`); continue; }
      const sellQty = Math.min(qty, p.qty), f = fx[p.ccy] || 1;
      const gross = sellQty * q.price * f;
      const fee = Math.round(gross * (ap.commissionPct || 0) / 100);
      ap.cashSEK = (ap.cashSEK || 0) + gross - fee;
      const pl = Math.round((q.price - p.avgBuy) * sellQty * f);
      p.qty -= sellQty;
      if(p.qty <= 0) positions.splice(positions.indexOf(p), 1);
      trades.push({ id: 't' + now + '_' + trades.length, ts: now, action: 'sell', ticker: p.ticker, name: p.name, qty: sellQty, price: q.price, ccy: p.ccy, fx: f, amountSEK: Math.round(gross), feeSEK: fee, plSEK: pl, reason: String(dec.reason || '').slice(0, 300), trigger: String(dec.trigger || '').slice(0, 120) });
    }else if(dec.action === 'buy'){
      const r0 = aipFindRow(snap, tk);
      const exist = positions.find(x => String(x.ticker).toUpperCase() === tk);
      const ccy = exist ? exist.ccy : (r0 ? String(r0[8] || 'USD') : null);
      if(!ccy){ skipped.push(`buy ${tk}: вне вселенной`); continue; }
      if(!marketsOpen[String(ccy).toUpperCase()]){ skipped.push(`buy ${tk}: рынок ${ccy} закрыт`); continue; }
      if((recoBy[tk] === 'wait' || recoBy[tk] === 'avoid') && !mentionsReco(dec.reason)){ skipped.push(`buy ${tk}: reco=${recoBy[tk]}, в reason нет объяснения отступления`); continue; }
      const q = await yahoo(exSymbol(tk, ccy));
      if(!(q && q.price > 0)){ skipped.push(`buy ${tk}: нет котировки`); continue; }
      const f = fx[ccy] || 1;
      const gross = qty * q.price * f;
      const fee = Math.round(gross * (ap.commissionPct || 0) / 100);
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
  ap.trades = ((ap.trades || []).concat(trades)).slice(-400);
  ap.lastRunAt = now;
  ap.lastNote = String(parsed.note || '').slice(0, 600);
  // Запись: перечитываем строку, настройки берём из свежей копии (клиент мог
  // их поменять, пока шёл цикл), торговое состояние — из нашего расчёта.
  const fresh = await loadRow(env);
  if(fresh){
    const fap = (fresh.snap && fresh.snap.aiPort) || {};
    if((fap.startedAt || 0) > (ap.startedAt || 0)){
      return 'Портфель обнулён во время цикла — результаты отброшены, следующий цикл стартует с чистого счёта';
    }
    ['strategy', 'intervalMin', 'commissionPct', 'minTradeSEK', 'enabled', 'startCapital', 'startedAt', 'myStartEquity', 'myStartLive'].forEach(k => { if(fap[k] !== undefined) ap[k] = fap[k]; });
    fresh.snap.aiPort = ap;
    fresh.snap.aiPortBak = JSON.parse(JSON.stringify(ap));   // быстрый резерв в той же строке
    await writeRow(env, fresh.userId, fresh.snap);
    await saveBak(env, fresh.userId, ap);                    // несгораемый резерв в ai_state
  }
  for(const t of trades){
    try{
      await sendTelegram(env, `🤖 <b>AI ПОРТФЕЛЬ — ${t.action === 'buy' ? '🟢 ПОКУПКА' : '🔴 ПРОДАЖА'}</b>\n<b>${esc(t.name || t.ticker)}</b> (${esc(t.ticker)}): ${t.qty} × ${t.price} ${t.ccy} ≈ <b>${t.amountSEK} kr</b>${t.plSEK != null ? `\nP&amp;L сделки: <b>${t.plSEK >= 0 ? '+' : ''}${t.plSEK} kr</b>` : ''}${t.trigger ? `\n⚡ ${esc(t.trigger)}` : ''}${t.reco && t.reco !== 'buy' ? `\n📋 вердикт скоринга: ${t.reco}` : ''}\n${esc(t.reason)}`);
    }catch(e){}
  }
  return `AI портфель: сделок ${trades.length} · equity ${eq2} kr · кэш ${Math.round(ap.cashSEK)} kr` +
    (skipped.length ? `\nОтклонено: ${skipped.join('; ')}` : '') +
    (ap.lastNote ? `\n💭 ${ap.lastNote}` : '');
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

// ── 🔬 AI-анализ одной акции с веб-поиском новостей (карточка → кнопка) ─────
// Клиент шлёт снапшот акции (цена, SMA, уровни, фундаментал, таргет) + контекст
// портфеля (доли по секторам, концентрация, кэш) + журнал прошлых анализов по
// этому тикеру (для сверки прогноз↔факт — «обучение»). Claude с web_search
// собирает свежие новости и возвращает структурированный разбор + JSON-сводку.
// FENCE объявлен в начале файла (нужен и для AI_SYSTEM выше).
const STOCKAI_SYSTEM = `Ты — старший инвестиционный аналитик. Тебе передают JSON по ОДНОЙ акции: цена, технические уровни (SMA 50/100/200, поддержка, сопротивление), фундаментал (P/E, P/S, выручка, маржа, долг/капитал, рост), консенсус-таргет аналитиков, тип и сектор; контекст портфеля инвестора (текущие доли по секторам, концентрация, свободный кэш в SEK, базовая валюта SEK); и priorAnalyses — твои прошлые разборы этой бумаги с ценой на тот момент (сверь прогноз с фактом — где ошибся, где попал — и откалибруй уверенность).

ОБЯЗАТЕЛЬНО используй web_search для свежих новостей и событий по компании (отчёты, гайденс, сделки, регуляторика, отраслевой фон) — на дату анализа. Кратко сошлись на найденное в разделе новостей.

Дай разбор на русском языке в markdown строго по разделам:

## 📰 Новости и события
3–5 пунктов: самое важное из веб-поиска за последние недели, с влиянием на кейс.

## 📊 Состояние акции
Техника (тренд относительно SMA, близость к уровням) + фундаментал (оценка, рост, прибыльность, долг) в 3–5 предложениях.

## 🚀 Драйверы роста
2–4 конкретных катализатора.

## ⚠️ Риски
2–4 главных риска.

## 🎯 Рекомендация
Чёткий вердикт: ДОБАВЛЯТЬ / НАБЛЮДАТЬ / НЕ ДОБАВЛЯТЬ — с обоснованием. Учитывай диверсификацию: если сектор уже перевешен в портфеле — скажи это. Укажи рекомендуемый размер позиции (% от капитала и сумму в SEK от свободного кэша), целевые зоны входа (ценовые уровни для покупки), целевую цену и потенциал роста (%), горизонт (недели/месяцы).

В САМОМ КОНЦЕ ответа добавь машиночитаемый блок (он не показывается пользователю) — fenced json, открой и закрой его символами ${FENCE} :
${FENCE}json
{"verdict":"add|watch|avoid","sizePct":<число или null>,"sizeSEK":<число или null>,"entryLow":<число или null>,"entryHigh":<число или null>,"targetPrice":<число или null>,"upsidePct":<число или null>,"horizon":"<строка>","confidence":"low|medium|high"}
${FENCE}
Цены — в торговой валюте бумаги. В конце основного текста одна строка: «Это аналитическая сводка, а не индивидуальная инвестиционная рекомендация.»`;

async function stockAnalyze(env, body){
  const today = new Date().toISOString().slice(0, 10);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      system: STOCKAI_SYSTEM,
      messages: [{ role: 'user', content: 'Сегодня ' + today + '. Снапшот акции и контекст (JSON):\n' + JSON.stringify(body || {}) }],
    }),
  });
  if(!r.ok) throw new Error('Claude API ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
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

Методика вердикта (учти каждый блок, отметь, что перевесило):
- ТЕХНИКА: тренд относительно SMA, фаза, расстояние до уровней. Падающий нож и перегрев — против покупки; цена у SMA 50/200 или поддержки при здоровом тренде — за покупку.
- ФУНДАМЕНТАЛ: прибыльность (ROE, маржа), темп роста, долговая нагрузка, качество FCF.
- ОЦЕНКА: дорого/дёшево к таргету, к медиане сектора и к собственной истории; PEG < 1 — рост недооценён. Низкие мультипликаторы часто бывают на ПИКЕ цикла — не путай дешевизну с возможностью.
- НОВОСТИ: меняют ли свежие события инвестиционный тезис (позитив / негатив / нейтрально).
- МАКРО: благоприятна ли среда для сектора и географии бумаги прямо сейчас.
- РИСК И ПОРТФЕЛЬ: перевес сектора, концентрация, тип бумаги (для Спекулятивной планка для «buy» выше; для Защитной/Дивидендной важнее стабильность, а не апсайд).

Выбери ОДИН вердикт строго из набора:
- "buy"   — покупать/докупать: техника и фундаментал на стороне покупателя, цена у уровня входа, новости и макро не противоречат тезису.
- "wait"  — ждать/держать: картина смешанная, или цена далеко от уровня входа, или ждём триггер (отчёт/событие) — явного перевеса нет.
- "sell"  — сократить/продать: цена у сопротивления / выше таргета / перегрев, либо ухудшение фундаментала или негативные новости.
- "avoid" — избегать/опасно: падающий нож, серьёзный негатив (новости/макро/фундаментал), высокий риск без компенсации.

Правила: опирайся на переданные цифры и результаты веб-поиска, не выдумывай данные; будь конкретен — называй уровни и проценты; если сигналы противоречат друг другу, прямо скажи, что перевесило и почему. Цены — в торговой валюте бумаги.

Сначала дай краткий разбор на русском языке в markdown по разделам:
## 📰 Новости и макро
## 📊 Техника
## 💪 Фундаментал и оценка
## 🎯 Вердикт и обоснование

В САМОМ КОНЦЕ ответа добавь машиночитаемый блок (пользователю не показывается) — fenced json, открой и закрой его символами ${FENCE} :
${FENCE}json
{"verdict":"buy|wait|sell|avoid","confidence":"low|medium|high","headline":"<одна строка — суть вердикта>","entryLow":<число или null>,"entryHigh":<число или null>,"keyRisks":["<риск 1>","<риск 2>"],"asOf":"<YYYY-MM-DD>"}
${FENCE}
В конце основного текста одна строка: «Это аналитическая сводка, а не индивидуальная инвестиционная рекомендация.»`;

async function recoAnalyze(env, body){
  const today = new Date().toISOString().slice(0, 10);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      system: RECO_SYSTEM,
      messages: [{ role: 'user', content: 'Сегодня ' + today + '. Снапшот акции и контекст (JSON):\n' + JSON.stringify(body || {}) }],
    }),
  });
  if(!r.ok) throw new Error('Claude API ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
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
  const verdict = data && V.has(String(data.verdict)) ? data.verdict : null;
  return { text: raw, verdict, data, cost: aiCost(j) };
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
async function saveBak(env, userId, ap){
  try{
    await fetch(`${env.SUPABASE_URL}/rest/v1/ai_state`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, port: ap, updated_at: new Date().toISOString() }),
    });
  }catch(e){ /* таблицы ещё нет — резерв в snap.aiPortBak продолжает работать */ }
}
async function loadRow(env){
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/ledger_state?select=user_id,data&order=updated_at.desc&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } });
  if(!r.ok) throw new Error('Supabase read failed: ' + r.status);
  const row = (await r.json())?.[0];
  return row ? { userId: row.user_id, snap: row.data } : null;
}
async function writeRow(env, userId, snap){
  const KEY = env.SUPABASE_SERVICE_KEY;
  await fetch(`${env.SUPABASE_URL}/rest/v1/ledger_state?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ data: snap, updated_at: new Date().toISOString() }),
  });
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


// ── Точечные алерты по акциям портфеля (заменяют старый дайджест) ──────────
// Одно сообщение на акцию и сигнал; кулдаун в snap.tgAlerts (клиент дашборда
// прокидывает это поле через свои сохранения, так что оно переживает sync).
const ALERT_NEAR = 1.5;       // ±% — «у уровня»
const ALERT_APPROACH = 4;     // % — «приближается к уровню»
const ALERT_COOLDOWN_H = 24;  // часов тишины по одному и тому же сигналу
async function runAlerts(env){
  const row = await loadRow(env);
  const snap = row && row.snap;
  const pf = snap && snap.data && (snap.data[PF3_KEY] || snap.data[PF_KEY]);
  if(!pf) return 'Портфель не найден';
  const tga = snap.tgAlerts = snap.tgAlerts || {};
  const now = Date.now();
  Object.keys(tga).forEach(k => { if(now - tga[k] > 7 * 86400e3) delete tga[k]; });
  const quotes = await Promise.all(pf.rows.map(r => yahoo(exSymbol(r[2], r[8]))));
  const sent = [];
  for(let i = 0; i < pf.rows.length; i++){
    const r = pf.rows[i], q = quotes[i];
    if(!q || !(q.price > 0)) continue;
    const name = esc(String(r[1] || r[2])), tk = esc(String(r[2] || '')), ccy = r[8] || '';
    const sym = exSymbol(r[2], r[8]);
    const qty = parseFloat(r[6]) || 0;
    const buys = [['SMA 50', q.sma50], ['SMA 100', q.sma100], ['SMA 200', q.sma200], ['Поддержка', q.support]].filter(([, v]) => v > 0);
    let best = null;
    for(const [n, v] of buys){ const d = (q.price - v) / v * 100; if(!best || Math.abs(d) < Math.abs(best.d)) best = { n, v, d }; }
    const resD = q.resistance > 0 ? (q.price - q.resistance) / q.resistance * 100 : null;
    let kind = null, msg = '';
    if(resD != null && Math.abs(resD) <= ALERT_NEAR){
      kind = 'sell';
      msg = `🔴 <b>ПРОДАЖА — ${name}</b> (${tk})\nЦена <b>${q.price} ${ccy}</b> у сопротивления <code>${q.resistance}</code> (${resD >= 0 ? '+' : ''}${resD.toFixed(1)}%) — зона фиксации прибыли`;
    }else if(best && Math.abs(best.d) <= ALERT_NEAR){
      kind = 'buy:' + best.n;
      msg = `🟢 <b>${qty > 0 ? 'ДОКУПКА' : 'ПОКУПКА'} — ${name}</b> (${tk})\nЦена <b>${q.price} ${ccy}</b> у уровня ${best.n} <code>${best.v}</code> (${best.d >= 0 ? '+' : ''}${best.d.toFixed(1)}%)`;
    }else if(resD != null && resD < 0 && -resD > ALERT_NEAR && -resD <= ALERT_APPROACH){
      kind = 'near:res';
      msg = `📡 <b>ПРИБЛИЖЕНИЕ — ${name}</b> (${tk})\nДо сопротивления <code>${q.resistance}</code> осталось <b>${(-resD).toFixed(1)}%</b> (цена ${q.price} ${ccy}) — готовьтесь фиксировать`;
    }else if(best && best.d > ALERT_NEAR && best.d <= ALERT_APPROACH){
      kind = 'near:' + best.n;
      msg = `📡 <b>ПРИБЛИЖЕНИЕ — ${name}</b> (${tk})\nДо уровня ${best.n} <code>${best.v}</code> осталось <b>${best.d.toFixed(1)}%</b> (цена ${q.price} ${ccy}) — следите за входом`;
    }
    if(!kind) continue;
    const key = sym + ':' + kind;
    if(tga[key] && now - tga[key] < ALERT_COOLDOWN_H * 3600e3) continue;
    await sendTelegram(env, msg);
    tga[key] = now;
    sent.push(String(r[2]) + ' → ' + kind);
  }
  if(sent.length){
    // Перечитываем строку перед записью: пока шёл прогон (десятки секунд на
    // котировки), клиент мог сохранить свежие данные — пишем кулдауны в НИХ,
    // а не возвращаем в облако снапшот, загруженный в начале прогона.
    const fresh = await loadRow(env);
    if(fresh){ fresh.snap.tgAlerts = Object.assign({}, fresh.snap.tgAlerts, tga); await writeRow(env, fresh.userId, fresh.snap); }
  }
  return sent.length ? 'Отправлено:\n' + sent.join('\n') : 'Сигналов нет (или все на кулдауне)';
}
export default {
  // Cron — only the targeted per-stock alerts (digest/chart/targets removed:
  // the dashboard refreshes targets itself once a day).
  async scheduled(event, env, ctx){
    ctx.waitUntil(Promise.all([
      runAlerts(env).catch(() => {}),
      aiPortfolioRun(env, false).catch(() => {}),   // гейт intervalMin внутри
    ]));
  },
  // GET ?symbols=AAPL,INVE-B.ST  → live prices (powers the dashboard's 🔄 Цены, US + Nordic/EU).
  // GET ?history=MU               → 2y daily closes (powers the dashboard's chart popup).
  // GET ?action=chart            → send the CHART_TICKER chart photo to Telegram now (manual test).
  // GET with no query             → run the alert report now (manual test).
  async fetch(request, env){
    const url = new URL(request.url);
    if(request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if(url.searchParams.get('action') === 'version'){
      // Живой статус торговых сессий — мгновенная проверка «часов» worker'а.
      const mkts = Object.keys(MARKET_HOURS).map(c => {
        const loc = new Intl.DateTimeFormat('en-GB', { timeZone: MARKET_HOURS[c].tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
        return `${c} ${loc} ${marketOpen(c) ? 'ОТКРЫТ' : 'закрыт'}`;
      }).join('\n');
      return txt(`worker-build ${WORKER_BUILD}\nфичи: aiport · market-hours · recoVerdict · stockai(web) · insider · targets · valuation · reco · prompts\n\nРынки сейчас:\n${mkts}`);
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
        const out = await aiAnalyze(env, snapshot);   // { text, proposal }
        return json(out);
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
      try{ return json(await aiChat(env, await request.json())); }
      catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'insider'){
      // POST {symbols:[...], from, to, windowDays}: батч инсайдерских сводок.
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      if(!env.FINNHUB_KEY) return json({ error: 'FINNHUB_KEY не задан — добавьте Secret в настройках worker' }, 500);
      try{
        const body = await request.json();
        const syms = (Array.isArray(body.symbols) ? body.symbols : []).slice(0, 25).map(s => String(s).trim().toUpperCase()).filter(Boolean);
        const today = new Date().toISOString().slice(0, 10);
        const from = body.from || new Date(Date.now() - 30 * 86400e3).toISOString().slice(0, 10);
        const to = body.to || today;
        const out = {};
        // Параллельно, но чанками по 8 — щадим Finnhub (60/min) и subrequest-лимит.
        for(let i = 0; i < syms.length; i += 8){
          const chunk = syms.slice(i, i + 8);
          await Promise.all(chunk.map(async s => {
            const r = await finnhubInsider(s, from, to, env.FINNHUB_KEY);
            out[s] = r.err ? { err: r.err } : { ...insiderAggregate(r.data, body.windowDays), from, to, at: new Date().toISOString() };
          }));
          if(i + 8 < syms.length) await sleep(300);
        }
        return json(out);
      }catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'insidernotify'){
      // POST {ticker,name,uniqueBuyers,sumUSD,windowDays,fromDate,toDate}: Telegram-алерт о кластере.
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{
        const b = await request.json();
        const sum = b.sumUSD ? ` · объём ≈ $${Number(b.sumUSD).toLocaleString('en-US')}` : '';
        await sendTelegram(env, `🕵 <b>CLUSTER BUY — ${esc(String(b.name || b.ticker))}</b> (${esc(String(b.ticker || ''))})\n${b.uniqueBuyers} инсайдер${b.uniqueBuyers >= 5 ? 'ов' : (b.uniqueBuyers >= 2 ? 'а' : '')} купили в окне ${b.windowDays || 10} дн.${sum}\n📅 ${b.fromDate || ''} — ${b.toDate || ''}`);
        return json({ ok: true });
      }catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
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
    if(url.searchParams.get('action') === 'valnotify'){
      // POST {ticker,name,detail}: Telegram-алерт о сильной недооценке (дёшево по обоим измерениям).
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{
        const b = await request.json();
        await sendTelegram(env, `📐 <b>НЕДООЦЕНКА — ${esc(String(b.name || b.ticker))}</b> (${esc(String(b.ticker || ''))})\n${esc(String(b.detail || 'дёшево относительно сектора и собственной истории'))}\n<i>Статистическое наблюдение, не сигнал к покупке.</i>`);
        return json({ ok: true });
      }catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'stockai'){
      if(!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY не задан' }, 500);
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{ return json(await stockAnalyze(env, await request.json())); }
      catch(e){ return json({ error: String(e.message || e) }, 500); }
    }
    if(url.searchParams.get('action') === 'reco'){
      // POST снапшот карточки → AI-Рекомендация (вердикт+разбор) с web_search.
      if(!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY не задан' }, 500);
      if(request.method !== 'POST') return json({ error: 'POST required' }, 405);
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{ return json(await recoAnalyze(env, await request.json())); }
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
      const adm = await requireAdmin(request, env);
      if(!adm.ok) return json({ error: adm.error }, 403);
      try{ return json({ result: await aiPortfolioRun(env, true) }); }
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
          about: 'Кнопка «🤖 AI-анализ» в карточке акции. Снапшот бумаги + контекст портфеля + прошлые разборы; через web_search — свежие новости; возвращает разбор и вердикт (добавлять/наблюдать/избегать), размер позиции, зоны входа, целевую цену, горизонт.',
          text: STOCKAI_SYSTEM },
        { name: '🔄 AI-Рекомендация (RECO_SYSTEM)',
          about: 'Кнопка «🔄 AI-Рекомендация» в карточке акции. Снапшот карточки (техника, фундаментал, оценка, контекст портфеля) + web_search свежих новостей и глобальной макрокартины; возвращает единый вердикт buy/wait/sell/avoid с уверенностью и обоснованием. Отдельно от детерминированного скоринга «Рекомендация».',
          text: RECO_SYSTEM },
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
    if(url.searchParams.has('history')){
      // Daily close series for one symbol → powers the dashboard's stock chart popup.
      // Optional &range= (e.g. 2y, 5y); defaults to 2y.
      const range = (url.searchParams.get('range') || '2y').trim();
      const h = await dailyHistory(url.searchParams.get('history').trim(), range);
      return json(h || { t: [], c: [] });
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
    try{
      return txt(await runAlerts(env));   // ручной прогон точечных алертов
    }catch(e){
      return txt('Error: ' + e.message, 500);
    }
  },
};

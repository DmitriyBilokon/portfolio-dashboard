// Cloudflare Worker — scheduled Telegram alerts for the Index Portfolio Dashboard.
//
// What it does (on a cron, even when the site is closed):
//   1. Reads your portfolio from Supabase (the synced ledger_state row).
//   2. Fetches live prices + technical levels (SMA 50/100/200, support, resistance) from Yahoo.
//   3. Sends one Telegram digest listing holdings whose price is within
//      ±NEAR_THRESHOLD% of any of those levels (silent when nothing is close),
//      then a chart image (price + SMA 50/100/200 + support/resistance) for CHART_TICKER.
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
//  Cron: Settings → Triggers → Cron Triggers → add e.g.  30 17 * * 1-5
//        (weekdays 17:30 UTC). Visit the Worker URL any time to test/send now.

const PF3_KEY = '🚀 Портфель 3.0';   // portfolio of record
const PF_KEY = '💼 Портфель 2.0';    // legacy key — read fallback only
const CHART_TICKER = 'MU';   // test mode: send a chart image for this holding only
const FX_DEFAULT = { SEK:1, EUR:10.59, USD:8.93, NOK:0.9375, DKK:1.52 };
const OVERRIDES = { 'NDB':'NDA-SE.ST', 'ASML':'ASML.AS', 'FCT':'FCT.MI', 'FIGMA':'FIG', 'RHM':'RHM.DE', 'RENK':'R3NK.DE', 'DELLIA':'DELIA.OL' };

function exSymbol(ticker, ccy){
  const t = String(ticker || '').trim().toUpperCase().replace(/\s+/g, '-');
  if(OVERRIDES[t]) return OVERRIDES[t];
  return ({ USD:t, SEK:t+'.ST', NOK:t+'.OL', DKK:t+'.CO', EUR:t+'.DE' })[String(ccy||'').toUpperCase()] || t;
}
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const round2 = n => Math.round(n * 100) / 100;
const tgApi = (env, method) => `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;

// Response helpers shared by every route.
const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', 'Content-Type':'application/json; charset=utf-8' };
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

// ── AI Assistant: portfolio analysis via the Claude API ─────────────────────
// The dashboard POSTs a portfolio snapshot (positions with live prices, SMA
// levels, support/resistance, analyst targets, cash/leverage); Claude returns a
// structured markdown report with sell/add/new-position recommendations.
const AI_SYSTEM = `Ты — опытный портфельный управляющий и аналитик. Тебе передают снапшот реального портфеля частного инвестора из Швеции (базовая валюта — шведская крона, kr) с живыми ценами, техническими уровнями (SMA 50/100/200, поддержка, сопротивление), консенсус-таргетами аналитиков, долями позиций и составом капитала (свободный кэш, кредитное плечо).

Дай структурированный анализ на русском языке в markdown строго по разделам:

## 📊 Ситуация в портфеле и на рынке
2–4 предложения: общее состояние (тренды позиций относительно SMA, концентрация, доля кэша).

## 🔴 Продать или сократить
Конкретные позиции с обоснованием (цена у сопротивления, превышение разумной доли, слабый тренд, цена выше таргета). Если кандидатов нет — так и скажи одной строкой.

## 🟢 Докупить
Какие позиции, на каких уровнях (используй переданные SMA/поддержку), какими частями от свободного кэша.

## ➕ Новые позиции
2–4 конкретные идеи (компания, тикер, биржа, почему, какую долю выделить) с учётом недостающих секторов и географии портфеля.

## ⚠️ Риски
Главные 2–3 риска текущего портфеля.

## ✅ План действий
Нумерованный список конкретных шагов на ближайшие 2–4 недели с суммами в kr.

Правила: опирайся на переданные данные и свои знания о компаниях; называй конкретные цифры (уровни входа, доли, суммы); будь лаконичен — без воды; в конце отчёта одна строка: «Это аналитическая сводка, а не индивидуальная инвестиционная рекомендация.»

Ответ верни строго в JSON по заданной схеме: поле report — весь анализ выше в markdown; поле proposal — машиночитаемый план ребалансировки портфеля: summary (2–3 предложения о целевой структуре) и actions — упорядоченный список конкретных сделок (action: Купить/Докупить/Сократить/Продать/Держать; details: уровень входа или выхода и краткое обоснование; amountSEK: примерная сумма сделки в кронах или null, если неприменимо).`;

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

async function aiAnalyze(env, snapshot){
  const today = new Date().toISOString().slice(0, 10);
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { format: { type: 'json_schema', schema: AI_SCHEMA } },
      system: AI_SYSTEM,
      messages: [{ role: 'user', content: `Сегодня ${today}. Снапшот портфеля (JSON):\n${JSON.stringify(snapshot)}` }],
    }),
  });
  if(!r.ok) throw new Error('Claude API ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  const raw = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  if(!raw) throw new Error('Пустой ответ модели');
  try{
    const parsed = JSON.parse(raw);
    if(parsed && parsed.report) return { text: parsed.report, proposal: parsed.proposal || null };
  }catch(e){ /* schema miss — fall back to raw text below */ }
  return { text: raw, proposal: null };
}

// ── Analyst target prices (FMP for US, Yahoo/Refinitiv consensus for EU/Nordic) ──
const TARGET_COL = 'Аналит. таргет';
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
  const tabs = [PF_KEY, PF3_KEY].map(k => row && row.snap && row.snap.data && row.snap.data[k]).filter(Boolean);
  if(!tabs.length) return { updated: 0, total: 0 };
  const cache = {};   // sym → result, shared across tabs (3.0 mirrors 2.0 holdings)
  const details = [];
  let updated = 0, total = 0, changed = false;
  for(const pf of tabs){
    let ti = pf.headers.indexOf(TARGET_COL);
    if(ti === -1){ pf.headers.push(TARGET_COL); ti = pf.headers.length - 1; changed = true; }
    pf.rows.forEach(r => { while(r.length < pf.headers.length) r.push(''); });
    for(const r of pf.rows){
      total++;
      const sym = exSymbol(r[2], r[8]);
      let res = cache[sym];
      if(res === undefined){
        res = await fmpTarget(sym, env);
        if(!(res && typeof res.avg === 'number')){
          const y = await yahooTarget(sym);   // EU/Nordic → Yahoo/Refinitiv consensus
          if(y) res = y;
        }
        cache[sym] = res;
        if(res && typeof res.avg === 'number') details.push(`✓ ${r[2]} (${sym}) → ${res.avg} · ${res.count} an.${res.src ? ' · ' + res.src : ''}`);
        else details.push(`— ${r[2]} (${sym}) [${(res && res.err) || '?'}]`);
        await sleep(250);   // stay under FMP's burst rate limit
      }
      if(res && typeof res.avg === 'number'){ r[ti] = res.avg; updated++; changed = true; }
    }
  }
  if(changed) await writeRow(env, row.userId, row.snap);
  return { updated, total, details };
}

export default {
  // Cron trigger — refresh analyst targets, then send the alert digest.
  async scheduled(event, env, ctx){
    ctx.waitUntil((async () => {
      try{ await updateTargets(env); }catch(e){ /* targets are best-effort */ }
      const text = await buildReport(env);
      if(text) await sendTelegram(env, text);
      try{ await sendChartMU(env); }catch(e){ /* chart is best-effort */ }
    })());
  },
  // GET ?symbols=AAPL,INVE-B.ST  → live prices (powers the dashboard's 🔄 Цены, US + Nordic/EU).
  // GET ?history=MU               → 2y daily closes (powers the dashboard's chart popup).
  // GET ?action=chart            → send the CHART_TICKER chart photo to Telegram now (manual test).
  // GET with no query             → run the alert report now (manual test).
  async fetch(request, env){
    const url = new URL(request.url);
    if(request.method === 'OPTIONS') return new Response(null, { headers: CORS });
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
      try{
        const snapshot = await request.json();
        const out = await aiAnalyze(env, snapshot);   // { text, proposal }
        return json(out);
      }catch(e){
        return json({ error: String(e.message || e) }, 500);
      }
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
      const per = url.searchParams.get('period') === 'quarter' ? 'quarter' : 'annual';
      const f = await fundamentals(url.searchParams.get('fundamentals').trim().toUpperCase(), env, per);
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
      const text = await buildReport(env);
      if(text){ await sendTelegram(env, text); return txt('Sent ✓\n\n' + text); }
      return txt('Nothing to report right now (no holding is near a level).');
    }catch(e){
      return txt('Error: ' + e.message, 500);
    }
  },
};

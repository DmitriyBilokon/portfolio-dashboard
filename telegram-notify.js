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
//     RESTRICT_FIRMS        (Text)    – optional, set "1" to only average the whitelisted firms
//  Cron: Settings → Triggers → Cron Triggers → add e.g.  30 17 * * 1-5
//        (weekdays 17:30 UTC). Visit the Worker URL any time to test/send now.

const PF_KEY = '💼 Портфель 2.0';
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

async function loadPortfolio(env){
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/ledger_state?select=data&order=updated_at.desc&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  if(!r.ok) throw new Error('Supabase read failed: ' + r.status);
  const snap = (await r.json())?.[0]?.data;
  if(!snap || !snap.data || !snap.data[PF_KEY]) return null;
  return { rows: snap.data[PF_KEY].rows, fx: snap.fx || FX_DEFAULT };
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

// ── Analyst target prices (Financial Modeling Prep) ────────────────────────
const TARGET_COL = 'Аналит. таргет';
// Optional firm whitelist — only applied when env RESTRICT_FIRMS === '1'.
// Off by default: restricting to these would blank most Nordic/EU holdings.
const TARGET_FIRMS = new Set([
  'kgi securities','fubon securities','gf securities','loop capital markets','evercore isi',
  'itau bba securities','oppenheimer','president capital management','craig-hallum','susquehanna',
  'new street research','benchmark co','bnp paribas','huatai research','aletheia capital',
  'ctbc securities','melius research','edgewater research','goldman sachs','d.a. davidson',
  'truist securities','jefferies','wedbush','keybanc capital markets','raymond james','banco safra',
  'cantor fitzgerald','mizuho securities','stifel','wells fargo','td cowen','seaport global',
  'barclays','summit insights group',
].map(s => s.toLowerCase()));

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
// Add the target column if missing, fill it from Yahoo, and persist back to Supabase.
async function updateTargets(env){
  const row = await loadRow(env);
  const pf = row && row.snap && row.snap.data && row.snap.data[PF_KEY];
  if(!pf) return { updated: 0, total: 0 };
  let ti = pf.headers.indexOf(TARGET_COL);
  const addedCol = ti === -1;
  if(addedCol){ pf.headers.push(TARGET_COL); ti = pf.headers.length - 1; }
  pf.rows.forEach(r => { while(r.length < pf.headers.length) r.push(''); });
  let updated = 0;
  const details = [];
  for(const r of pf.rows){
    const sym = exSymbol(r[2], r[8]);
    const res = await fmpTarget(sym, env);
    if(res && typeof res.avg === 'number'){ r[ti] = res.avg; updated++; details.push(`✓ ${r[2]} (${sym}) → ${res.avg} · ${res.count} an.`); }
    else details.push(`— ${r[2]} (${sym}) [${(res && res.err) || '?'}]`);
    await sleep(250);   // stay under FMP's burst rate limit
  }
  if(addedCol || updated > 0) await writeRow(env, row.userId, row.snap);
  return { updated, total: pf.rows.length, details };
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
    const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET, OPTIONS', 'Content-Type':'application/json; charset=utf-8' };
    if(request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if(url.searchParams.get('action') === 'targets'){
      const dbg = url.searchParams.get('debug');   // ?action=targets&debug=NVDA → raw FMP reply
      if(dbg){
        const fr = await fetch(`https://financialmodelingprep.com/stable/price-target-summary?symbol=${encodeURIComponent(dbg)}&apikey=${env.FMP_KEY}`);
        return new Response(`FMP HTTP ${fr.status}\n\n` + await fr.text(), { headers: { 'Content-Type':'text/plain; charset=utf-8' } });
      }
      try{ const t = await updateTargets(env); return new Response(`Targets updated: ${t.updated}/${t.total}\n\n${(t.details || []).join('\n')}`, { headers: { 'Content-Type':'text/plain; charset=utf-8' } }); }
      catch(e){ return new Response('Error: ' + e.message, { status: 500 }); }
    }
    if(url.searchParams.has('history')){
      // Daily close series for one symbol → powers the dashboard's stock chart popup.
      // Optional &range= (e.g. 2y, 5y); defaults to 2y.
      const range = (url.searchParams.get('range') || '2y').trim();
      const h = await dailyHistory(url.searchParams.get('history').trim(), range);
      return new Response(JSON.stringify(h || { t: [], c: [] }), { headers: CORS });
    }
    if(url.searchParams.get('action') === 'chart'){
      // Manual test: send the CHART_TICKER chart photo to Telegram now.
      try{ const ok = await sendChartMU(env); return new Response(ok ? `Chart sent ✓ (${CHART_TICKER})` : `No chart (${CHART_TICKER} not in portfolio or render failed)`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
      catch(e){ return new Response('Error: ' + e.message, { status: 500 }); }
    }
    if(url.searchParams.has('symbols')){
      const syms = url.searchParams.get('symbols').split(',').map(s => s.trim()).filter(Boolean);
      const out = {};
      await Promise.all(syms.map(async s => {
        const q = await yahoo(s);
        if(q){ const w = await weeklySMA(s); if(w) Object.assign(q, w); }   // add sma50w/100w/200w (3-year view)
        out[s] = q;   // {price, pct, sma50/100/200, support, resistance, sma50w/100w/200w} | null
      }));
      return new Response(JSON.stringify(out), { headers: CORS });
    }
    try{
      const text = await buildReport(env);
      if(text){ await sendTelegram(env, text); return new Response('Sent ✓\n\n' + text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
      return new Response('Nothing to report right now (no holding is near a level).', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }catch(e){
      return new Response('Error: ' + e.message, { status: 500 });
    }
  },
};

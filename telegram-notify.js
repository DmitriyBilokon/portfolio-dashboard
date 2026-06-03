// Cloudflare Worker — scheduled Telegram alerts for the Index Portfolio Dashboard.
//
// What it does (on a cron, even when the site is closed):
//   1. Reads your portfolio from Supabase (the synced ledger_state row).
//   2. Fetches live prices + technical levels (SMA 50/100/200, support, resistance) from Yahoo.
//   3. Sends one Telegram digest listing holdings whose price is within
//      ±NEAR_THRESHOLD% of any of those levels.
//   It stays silent when nothing is close.
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
const FX_DEFAULT = { SEK:1, EUR:10.59, USD:8.93, NOK:0.9375, DKK:1.52 };
const OVERRIDES = { 'NDB':'NDA-SE.ST', 'ASML':'ASML.AS', 'FCT':'FCT.MI', 'FIGMA':'FIG', 'RHM':'RHM.DE', 'RENK':'R3NK.DE', 'DELLIA':'DELIA.OL' };

function exSymbol(ticker, ccy){
  const t = String(ticker || '').trim().toUpperCase().replace(/\s+/g, '-');
  if(OVERRIDES[t]) return OVERRIDES[t];
  return ({ USD:t, SEK:t+'.ST', NOK:t+'.OL', DKK:t+'.CO', EUR:t+'.DE' })[String(ccy||'').toUpperCase()] || t;
}
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// One year of daily candles → current price, day change %, SMA 50/100/200,
// and support / resistance (rolling 3-month low/high). All in native currency,
// matching the price column; fields are null when there isn't enough history.
const SR_WINDOW = 60;   // trading days (~3 months) for support/resistance
async function yahoo(sym){
  try{
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1y`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
    );
    if(!r.ok) return null;
    const res = (await r.json())?.chart?.result?.[0];
    const m = res?.meta;
    if(!m || typeof m.regularMarketPrice !== 'number') return null;
    const q = res?.indicators?.quote?.[0] || {};
    const closes = (q.close || []).filter(v => typeof v === 'number' && v > 0);
    const lows = (q.low || []).filter(v => typeof v === 'number' && v > 0).slice(-SR_WINDOW);
    const highs = (q.high || []).filter(v => typeof v === 'number' && v > 0).slice(-SR_WINDOW);
    const price = m.regularMarketPrice;
    const prev = closes.length >= 2 ? closes[closes.length - 2] : (m.chartPreviousClose || m.previousClose);
    const pct = (prev && prev > 0) ? (price - prev) / prev * 100 : null;
    const sma = n => {
      if(closes.length < n) return null;
      let s = 0; for(let i = closes.length - n; i < closes.length; i++) s += closes[i];
      return Math.round(s / n * 100) / 100;
    };
    const r2 = n => Math.round(n * 100) / 100;
    return {
      price, pct,
      sma50: sma(50), sma100: sma(100), sma200: sma(200),
      support: lows.length ? r2(Math.min(...lows)) : null,
      resistance: highs.length ? r2(Math.max(...highs)) : null,
    };
  }catch(e){ return null; }
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
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if(!r.ok) throw new Error('Telegram send failed: ' + r.status + ' ' + (await r.text()));
}

// Portfolio row schema (indices): 1 name · 2 ticker · 8 ccy
// Alert when the live price is within ±NEAR_THRESHOLD% of any technical level
// (SMA 50/100/200, support, resistance). Silent when nothing is close.
async function buildReport(env){
  const pf = await loadPortfolio(env);
  if(!pf) return null;
  const nearPct = parseFloat(env.NEAR_THRESHOLD || '10');
  const blocks = [];

  for(const row of pf.rows){
    const name = esc(row[1]), ticker = row[2], ccy = row[8];
    const q = await yahoo(exSymbol(ticker, ccy));
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

const round2 = n => Math.round(n * 100) / 100;
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
    })());
  },
  // GET ?symbols=AAPL,INVE-B.ST  → live prices (powers the dashboard's 🔄 Цены, US + Nordic/EU).
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
    if(url.searchParams.has('symbols')){
      const syms = url.searchParams.get('symbols').split(',').map(s => s.trim()).filter(Boolean);
      const out = {};
      await Promise.all(syms.map(async s => { out[s] = await yahoo(s); }));   // {price, pct, sma50, sma100, sma200} | null
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

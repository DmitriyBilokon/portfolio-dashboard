// Cloudflare Worker — scheduled Telegram alerts for the Index Portfolio Dashboard.
//
// What it does (on a cron, even when the site is closed):
//   1. Reads your portfolio from Supabase (the synced ledger_state row).
//   2. Fetches live prices + day change from Yahoo Finance.
//   3. Sends one Telegram digest with: big daily movers, holdings that reached
//      their target value, and holdings whose action is Buy/Sell/Trim.
//   It stays silent when there's nothing to report.
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
//     MOVER_THRESHOLD       (Text)    – optional, percent (default 5)
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

async function yahoo(sym){
  try{
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2d`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
    );
    if(!r.ok) return null;
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    if(!m || typeof m.regularMarketPrice !== 'number') return null;
    const prev = m.chartPreviousClose || m.previousClose;
    const pct = (prev && prev > 0) ? (m.regularMarketPrice - prev) / prev * 100 : null;
    return { price: m.regularMarketPrice, pct };
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

// Portfolio row schema (indices):
// 1 name · 2 ticker · 6 qty · 7 price · 8 ccy · 10 day% · 19 targetKr · 21 action
async function buildReport(env){
  const pf = await loadPortfolio(env);
  if(!pf) return null;
  const thr = parseFloat(env.MOVER_THRESHOLD || '5');
  const movers = [], targets = [], actions = [];

  for(const row of pf.rows){
    const name = esc(row[1]), ticker = row[2], qty = +row[6] || 0;
    const ccy = row[8], fx = pf.fx[ccy] || 1;
    const targetKr = +row[19] || 0, action = String(row[21] || '');
    const q = await yahoo(exSymbol(ticker, ccy));
    const price = q ? q.price : (+row[7] || 0);
    const valueKr = Math.round(qty * price * fx);

    if(q && q.pct != null && Math.abs(q.pct) >= thr)
      movers.push(`${q.pct >= 0 ? '🟢' : '🔴'} <b>${name}</b> ${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(1)}%  ·  ${price} ${ccy}`);
    if(targetKr > 0 && valueKr >= targetKr)
      targets.push(`🎯 <b>${name}</b> — ${valueKr.toLocaleString()} ≥ ${targetKr.toLocaleString()} kr`);
    if(/Прод|Сократ|Купить/i.test(action))
      actions.push(`${esc(action)} — <b>${name}</b>`);
  }

  const parts = [];
  if(movers.length)  parts.push(`<b>📊 Движения дня (±${thr}%)</b>\n` + movers.join('\n'));
  if(targets.length) parts.push('<b>🎯 Достигнута цель</b>\n' + targets.join('\n'));
  if(actions.length) parts.push('<b>⚡ Действия</b>\n' + actions.join('\n'));
  return parts.length ? ('📈 <b>Index Portfolio Dashboard</b>\n\n' + parts.join('\n\n')) : null;
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

// Average of analyst targets published in the last 90 days for one symbol.
// Returns { avg, count } or null. Uses FMP's per-analyst price-target feed.
async function fmpTarget(symbol, env){
  try{
    const r = await fetch(`https://financialmodelingprep.com/api/v4/price-target?symbol=${encodeURIComponent(symbol)}&apikey=${env.FMP_KEY}`);
    if(!r.ok) return null;
    const arr = await r.json();
    if(!Array.isArray(arr) || !arr.length) return null;
    const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
    const restrict = env.RESTRICT_FIRMS === '1';
    const vals = [];
    for(const x of arr){
      const d = Date.parse(x.publishedDate);
      if(isNaN(d) || d < cutoff) continue;                                  // only last 3 months
      if(restrict && !TARGET_FIRMS.has(String(x.analystCompany || '').toLowerCase())) continue;
      const pt = x.adjPriceTarget || x.priceTarget;
      if(typeof pt === 'number' && pt > 0) vals.push(pt);
    }
    if(!vals.length) return null;
    return { avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100, count: vals.length };
  }catch(e){ return null; }
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
  for(const r of pf.rows){
    const res = await fmpTarget(exSymbol(r[2], r[8]), env);
    if(res){ r[ti] = res.avg; updated++; }
  }
  if(addedCol || updated > 0) await writeRow(env, row.userId, row.snap);
  return { updated, total: pf.rows.length };
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
      try{ const t = await updateTargets(env); return new Response(`Targets updated: ${t.updated}/${t.total}`, { headers: { 'Content-Type':'text/plain; charset=utf-8' } }); }
      catch(e){ return new Response('Error: ' + e.message, { status: 500 }); }
    }
    if(url.searchParams.has('symbols')){
      const syms = url.searchParams.get('symbols').split(',').map(s => s.trim()).filter(Boolean);
      const out = {};
      await Promise.all(syms.map(async s => { const q = await yahoo(s); out[s] = q ? q.price : null; }));
      return new Response(JSON.stringify(out), { headers: CORS });
    }
    try{
      const text = await buildReport(env);
      if(text){ await sendTelegram(env, text); return new Response('Sent ✓\n\n' + text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
      return new Response('Nothing to report right now (no movers / targets / actions).', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }catch(e){
      return new Response('Error: ' + e.message, { status: 500 });
    }
  },
};

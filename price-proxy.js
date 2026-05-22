// Cloudflare Worker — tiny price proxy for the Index Portfolio Dashboard.
// Browsers can't call Yahoo Finance directly (CORS), so this reads it
// server-side and returns { "<symbol>": <price|null> } with open CORS.
//
// Deploy (≈3 min, free):
//   1. dash.cloudflare.com → Workers & Pages → Create → Worker
//   2. Replace the starter code with this file, click Deploy
//   3. Copy the *.workers.dev URL → paste into PRICE_PROXY in app.js
//
// Test: https://<your-worker>.workers.dev/?symbols=AAPL,INVE-B.ST,EQNR.OL

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const { searchParams } = new URL(request.url);
    const symbols = (searchParams.get('symbols') || '')
      .split(',').map(s => s.trim()).filter(Boolean);

    if (!symbols.length) {
      return new Response(
        JSON.stringify({ error: 'Pass ?symbols=AAPL,INVE-B.ST,EQNR.OL' }),
        { status: 400, headers: CORS }
      );
    }

    const out = {};
    await Promise.all(symbols.map(async (sym) => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
        );
        if (!r.ok) { out[sym] = null; return; }
        const j = await r.json();
        const p = j && j.chart && j.chart.result && j.chart.result[0]
          && j.chart.result[0].meta && j.chart.result[0].meta.regularMarketPrice;
        out[sym] = (typeof p === 'number' && p > 0) ? p : null;
      } catch (e) {
        out[sym] = null;
      }
    }));

    return new Response(JSON.stringify(out), { headers: CORS });
  },
};

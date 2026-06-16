import type { Snapshot, Portfolio, Position, Trade } from './types';

// Снапшот текущего сайта = snapshotState(): { data: DATA(map вкладок), fx, rev, ... }.
// Каждая вкладка-портфель = { headers:[…], rows:[[…]] }. Колонки могут отличаться
// порядком/набором между портфелями, поэтому ищем их ПО ИМЕНИ заголовка.

function num(v: any): number {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

function findCol(headers: string[], res: RegExp[]): number {
  for (const re of res) {
    const i = headers.findIndex((h) => re.test(String(h || '')));
    if (i >= 0) return i;
  }
  return -1;
}

function parseTab(key: string, tab: any, fx: Record<string, number>): Portfolio | null {
  if (!tab || !Array.isArray(tab.rows) || !Array.isArray(tab.headers)) return null;
  const h: string[] = tab.headers;
  const c = {
    name: findCol(h, [/компани/i, /^name/i, /назван/i]),
    ticker: findCol(h, [/тикер/i, /ticker/i, /symbol/i]),
    country: findCol(h, [/страна/i, /country/i]),
    sector: findCol(h, [/сектор/i, /sector/i]),
    type: findCol(h, [/^тип/i, /^type/i]),
    qty: findCol(h, [/кол-?во/i, /qty|quantity|shares/i]),
    price: findCol(h, [/^цена/i, /^price/i]),
    ccy: findCol(h, [/валюта/i, /currency|ccy/i]),
    buy: findCol(h, [/покупка/i, /avg|buy|cost/i]),
    day: findCol(h, [/1д|за день|day/i]),
    val: findCol(h, [/стоимость|value/i]),
    target: findCol(h, [/целевая|таргет|target/i]),
  };
  if (c.qty < 0 || c.ticker < 0) return null;

  const positions: Position[] = [];
  for (const r of tab.rows) {
    const qty = num(r[c.qty]);
    if (!(qty > 0)) continue;
    const ccy = c.ccy >= 0 ? String(r[c.ccy] || 'USD').toUpperCase() : 'USD';
    const price = c.price >= 0 ? num(r[c.price]) : 0;
    const rate = fx[ccy] || 1;
    const valSEK = c.val >= 0 && num(r[c.val]) > 0 ? num(r[c.val]) : qty * price * rate;
    positions.push({
      ticker: String(r[c.ticker] || '').toUpperCase(),
      name: c.name >= 0 ? String(r[c.name] || r[c.ticker] || '') : String(r[c.ticker] || ''),
      country: c.country >= 0 ? String(r[c.country] || '') : '',
      sector: c.sector >= 0 ? String(r[c.sector] || '—') : '—',
      type: c.type >= 0 ? String(r[c.type] || '—') : '—',
      qty,
      price,
      ccy,
      buy: c.buy >= 0 ? num(r[c.buy]) : 0,
      dayPct: c.day >= 0 && r[c.day] !== '' && r[c.day] != null ? num(r[c.day]) : null,
      target: c.target >= 0 && num(r[c.target]) > 0 ? num(r[c.target]) : null,
      valSEK,
    });
  }
  if (!positions.length) return null;
  const label = (tab.title && String(tab.title)) || key.replace(/^[^\p{L}\p{N}]+/u, '').trim() || key;
  return { key, label, positions };
}

export function parseSnapshot(snap: any, updatedAt: string | null): Snapshot {
  const fx: Record<string, number> = (snap && snap.fx) || { SEK: 1 };
  fx.SEK = 1;
  const dataMap = (snap && snap.data) || {};
  const portfolios: Portfolio[] = [];
  for (const key of Object.keys(dataMap)) {
    const p = parseTab(key, dataMap[key], fx);
    if (p) portfolios.push(p);
  }
  // Самый «крупный» портфель — первым.
  portfolios.sort((a, b) => totalValue(b) - totalValue(a));
  return { portfolios, trades: parseTrades(snap), fx, updatedAt, rev: num(snap && snap.rev) };
}

// Журнал сделок текущего сайта (snap.pfTrades) → плоский список Trade.
function parseTrades(snap: any): Trade[] {
  const raw = snap && Array.isArray(snap.pfTrades) ? snap.pfTrades : [];
  return raw.map((t: any) => ({
    tab: String(t.tab || ''),
    ticker: String(t.tk || t.ticker || '').toUpperCase(),
    name: String(t.name || t.tk || ''),
    ccy: String(t.ccy || 'USD').toUpperCase(),
    act: t.act === 'sell' ? 'sell' : 'buy',
    qty: num(t.qty),
    price: num(t.price),
    plNative: t.plNative != null && isFinite(parseFloat(t.plNative)) ? num(t.plNative) : null,
    date: String(t.date || ''),
    feeNative: t.feeNative != null && isFinite(parseFloat(t.feeNative)) ? num(t.feeNative) : null,
  }));
}

export function totalValue(p: Portfolio): number {
  return p.positions.reduce((s, x) => s + (x.valSEK || 0), 0);
}

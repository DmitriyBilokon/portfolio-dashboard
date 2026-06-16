import { WORKER_URL } from './config';
import type { Quote, Snapshot } from './types';

const OVERRIDES: Record<string, string> = {};

// Тикер → символ Yahoo для воркера (как exSymbol в текущем сайте).
export function exSymbol(ticker: string, ccy: string): string {
  const t = String(ticker || '').trim().toUpperCase().replace(/\s+/g, '-');
  if (OVERRIDES[t]) return OVERRIDES[t];
  if (t.includes('.')) return t;
  switch (String(ccy || '').toUpperCase()) {
    case 'USD':
      return t;
    case 'SEK':
      return t + '.ST';
    case 'NOK':
      return t + '.OL';
    case 'DKK':
      return t + '.CO';
    case 'EUR':
      return t + '.DE';
    default:
      return t;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Живые котировки от воркера. Батчим по 15 символов (воркер делает несколько
// субзапросов на символ — Cloudflare ограничивает их число).
export async function fetchQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  const uniq = [...new Set(symbols.filter(Boolean))];
  const result: Record<string, Quote> = {};
  await Promise.all(
    chunk(uniq, 15).map(async (group) => {
      try {
        const url = `${WORKER_URL}?symbols=${encodeURIComponent(group.join(','))}`;
        const r = await fetch(url);
        if (!r.ok) return;
        const j = (await r.json()) as Record<string, Quote>;
        for (const k of Object.keys(j || {})) result[k] = j[k];
      } catch {
        /* пропускаем чанк — покажем сохранённые цены */
      }
    }),
  );
  return result;
}

// Возвращает НОВЫЙ снапшот с обновлёнными ценами/днём/стоимостью; считает,
// сколько позиций удалось обновить вживую.
export async function refreshPrices(snap: Snapshot): Promise<{ snap: Snapshot; updated: number }> {
  const syms: string[] = [];
  const symOf = new Map<string, string>();
  for (const p of snap.portfolios) {
    for (const pos of p.positions) {
      const s = exSymbol(pos.ticker, pos.ccy);
      symOf.set(pos.ticker + '|' + pos.ccy, s);
      syms.push(s);
    }
  }
  const quotes = await fetchQuotes(syms);
  let updated = 0;
  const portfolios = snap.portfolios.map((p) => ({
    ...p,
    positions: p.positions.map((pos) => {
      const q = quotes[symOf.get(pos.ticker + '|' + pos.ccy) || ''];
      if (!q || typeof q.price !== 'number' || !(q.price > 0)) return pos;
      updated++;
      const rate = snap.fx[pos.ccy] || 1;
      return {
        ...pos,
        price: q.price,
        dayPct: typeof q.pct === 'number' ? Math.round(q.pct * 100) / 100 : pos.dayPct,
        valSEK: pos.qty * q.price * rate,
      };
    }),
  }));
  return { snap: { ...snap, portfolios }, updated };
}

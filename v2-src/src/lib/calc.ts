import type { Portfolio, Position } from './types';

export interface PortfolioStats {
  total: number; // SEK
  dayChangeSEK: number;
  dayChangePct: number;
  plSEK: number; // нереализованная прибыль vs покупка
  plPct: number;
  investedSEK: number;
  count: number;
}

export function statsFor(p: Portfolio, fx: Record<string, number>): PortfolioStats {
  let total = 0,
    dayChangeSEK = 0,
    invested = 0,
    prevTotal = 0;
  for (const x of p.positions) {
    const rate = fx[x.ccy] || 1;
    total += x.valSEK;
    invested += x.qty * x.buy * rate;
    if (x.dayPct != null) {
      // valSEK сегодняшняя → вчерашняя = val / (1 + day%/100)
      const prev = x.valSEK / (1 + x.dayPct / 100);
      dayChangeSEK += x.valSEK - prev;
      prevTotal += prev;
    } else {
      prevTotal += x.valSEK;
    }
  }
  const plSEK = total - invested;
  return {
    total,
    dayChangeSEK,
    dayChangePct: prevTotal > 0 ? (dayChangeSEK / prevTotal) * 100 : 0,
    plSEK,
    plPct: invested > 0 ? (plSEK / invested) * 100 : 0,
    investedSEK: invested,
    count: p.positions.length,
  };
}

export interface AllocSlice {
  label: string;
  valSEK: number;
  pct: number;
}

function allocBy(p: Portfolio, keyFn: (x: Position) => string): AllocSlice[] {
  const map = new Map<string, number>();
  let total = 0;
  for (const x of p.positions) {
    const k = keyFn(x) || '—';
    map.set(k, (map.get(k) || 0) + x.valSEK);
    total += x.valSEK;
  }
  return [...map.entries()]
    .map(([label, valSEK]) => ({ label, valSEK, pct: total > 0 ? (valSEK / total) * 100 : 0 }))
    .sort((a, b) => b.valSEK - a.valSEK);
}

export const allocBySector = (p: Portfolio) => allocBy(p, (x) => x.sector);
export const allocByType = (p: Portfolio) => allocBy(p, (x) => x.type);
export const allocByCurrency = (p: Portfolio) => allocBy(p, (x) => x.ccy);

export function topMovers(p: Portfolio, n = 5): Position[] {
  return [...p.positions]
    .filter((x) => x.dayPct != null)
    .sort((a, b) => Math.abs(b.dayPct!) - Math.abs(a.dayPct!))
    .slice(0, n);
}

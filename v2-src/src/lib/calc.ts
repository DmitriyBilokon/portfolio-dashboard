import type { Portfolio, Position, Trade } from './types';

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

// ── Сектора: доля + средневзвешенное изменение за день по сектору ──
export interface SectorRow {
  label: string;
  valSEK: number;
  pct: number;
  dayPct: number | null;
  count: number;
}

export function sectorPerf(p: Portfolio): SectorRow[] {
  const m = new Map<string, { val: number; prev: number; today: number; count: number }>();
  let total = 0;
  for (const x of p.positions) {
    const k = x.sector || '—';
    const o = m.get(k) || { val: 0, prev: 0, today: 0, count: 0 };
    o.val += x.valSEK;
    o.count++;
    if (x.dayPct != null) {
      o.prev += x.valSEK / (1 + x.dayPct / 100);
      o.today += x.valSEK;
    }
    m.set(k, o);
    total += x.valSEK;
  }
  return [...m.entries()]
    .map(([label, o]) => ({
      label,
      valSEK: o.val,
      pct: total > 0 ? (o.val / total) * 100 : 0,
      count: o.count,
      dayPct: o.prev > 0 ? (o.today / o.prev - 1) * 100 : null,
    }))
    .sort((a, b) => b.valSEK - a.valSEK);
}

// ── Диверсификация: концентрация портфеля ──
export interface DiversInfo {
  count: number;
  topWeight: number; // % крупнейшей позиции
  top3Weight: number; // % топ-3
  hhi: number; // индекс Херфиндаля (0..1), выше = концентрированнее
  sectorCount: number;
  largestSector: string;
  largestSectorPct: number;
  ccyCount: number;
}

export function diversification(p: Portfolio): DiversInfo {
  const total = p.positions.reduce((s, x) => s + x.valSEK, 0);
  const weights = p.positions
    .map((x) => (total > 0 ? (x.valSEK / total) * 100 : 0))
    .sort((a, b) => b - a);
  const hhi = weights.reduce((s, w) => s + (w / 100) * (w / 100), 0);
  const sectors = allocBySector(p);
  const ccys = new Set(p.positions.map((x) => x.ccy));
  return {
    count: p.positions.length,
    topWeight: weights[0] || 0,
    top3Weight: weights.slice(0, 3).reduce((a, b) => a + b, 0),
    hhi,
    sectorCount: sectors.length,
    largestSector: sectors[0]?.label || '—',
    largestSectorPct: sectors[0]?.pct || 0,
    ccyCount: ccys.size,
  };
}

// ── Журнал сделок одного портфеля + реализованный P&L (SEK) ──
export interface TradeView extends Trade {
  plSEK: number | null;
}

export function tradesFor(
  trades: Trade[],
  tab: string,
  fx: Record<string, number>,
): { rows: TradeView[]; realizedSEK: number; hasSell: boolean } {
  const rows = trades
    .filter((t) => t.tab === tab)
    .map((t) => ({ ...t, plSEK: t.plNative != null ? t.plNative * (fx[t.ccy] || 1) : null }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const realizedSEK = rows.reduce((s, t) => s + (t.plSEK || 0), 0);
  const hasSell = rows.some((t) => t.plSEK != null);
  return { rows, realizedSEK, hasSell };
}

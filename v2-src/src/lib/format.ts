import { BASE_UNIT } from './config';

export function fmt(n: number | null | undefined, dec = 0): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!isFinite(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Деньги в базовой валюте (SEK → «12 345 kr»).
export function money(sek: number | null | undefined, dec = 0): string {
  const v = typeof sek === 'number' ? sek : Number(sek);
  if (!isFinite(v)) return '—';
  return `${fmt(v, dec)} ${BASE_UNIT}`;
}

export function pct(n: number | null | undefined, dec = 1, withSign = true): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!isFinite(v)) return '—';
  const s = withSign && v > 0 ? '+' : '';
  return `${s}${v.toFixed(dec)}%`;
}

// Класс цвета для дельты (вверх/вниз/нейтрально).
export function deltaClass(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!isFinite(v) || v === 0) return 'text-dim';
  return v > 0 ? 'text-up' : 'text-down';
}

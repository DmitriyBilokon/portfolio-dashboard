// Доменные типы v2. Позиция нормализована из «сырой» строки снапшота (snapshot.ts).
export interface Position {
  ticker: string;
  name: string;
  country: string;
  sector: string;
  type: string;
  qty: number;
  price: number; // в валюте бумаги
  ccy: string;
  buy: number; // средняя цена покупки, в валюте бумаги
  dayPct: number | null; // изменение за день, %
  target: number | null; // аналит. таргет (за всё время), в валюте бумаги
  valSEK: number; // стоимость позиции в SEK (base)
}

export interface Portfolio {
  key: string; // имя вкладки/портфеля
  label: string;
  positions: Position[];
}

export interface Snapshot {
  portfolios: Portfolio[];
  fx: Record<string, number>; // SEK за 1 единицу валюты
  updatedAt: string | null;
  rev: number;
}

export type Lang = 'ru' | 'en';
export type Theme = 'dark' | 'light';
export type Route = 'dashboard' | 'holdings';

// Живая котировка от воркера (?symbols=…).
export interface Quote {
  price?: number;
  pct?: number;
  sma50?: number;
  sma200?: number;
}

import { derived } from 'svelte/store';
import { lang } from './stores';
import type { Lang } from './types';

type Dict = Record<string, [ru: string, en: string]>;

// Небольшой словарь интерфейса (RU/EN), как в текущем сайте.
const DICT: Dict = {
  dashboard: ['Дашборд', 'Dashboard'],
  holdings: ['Холдинги', 'Holdings'],
  portfolio: ['Портфель', 'Portfolio'],
  netWorth: ['Чистый капитал', 'Net worth'],
  dayChange: ['Изменение за день', 'Day change'],
  totalPL: ['Прибыль', 'Total P&L'],
  positions: ['Позиции', 'Positions'],
  allocation: ['Распределение', 'Allocation'],
  bySector: ['По секторам', 'By sector'],
  byType: ['По типу', 'By type'],
  byCurrency: ['По валюте', 'By currency'],
  topMovers: ['Лидеры дня', 'Top movers'],
  refresh: ['Обновить цены', 'Refresh prices'],
  signIn: ['Войти', 'Sign in'],
  signOut: ['Выйти', 'Sign out'],
  email: ['Email', 'Email'],
  password: ['Пароль', 'Password'],
  loading: ['Загрузка…', 'Loading…'],
  connectAccount: ['Подключите аккаунт, чтобы увидеть портфель', 'Sign in to load your portfolio'],
  name: ['Компания', 'Name'],
  ticker: ['Тикер', 'Ticker'],
  qty: ['Кол-во', 'Qty'],
  price: ['Цена', 'Price'],
  value: ['Стоимость', 'Value'],
  weight: ['Доля', 'Weight'],
  buy: ['Покупка', 'Buy'],
  target: ['Таргет', 'Target'],
  upside: ['Потенциал', 'Upside'],
  search: ['Поиск…', 'Search…'],
  noData: ['Нет данных', 'No data'],
  asOf: ['обновлено', 'as of'],
  invested: ['вложено', 'invested'],
  sector: ['Сектор', 'Sector'],
  updated: ['Цены обновлены', 'Prices refreshed'],
  refreshFail: ['Не удалось обновить цены', 'Could not refresh prices'],
};

function pick(key: string, l: Lang): string {
  const e = DICT[key];
  if (!e) return key;
  return l === 'en' ? e[1] : e[0];
}

// Реактивный переводчик: $t('holdings').
export const t = derived(lang, ($lang) => (key: string) => pick(key, $lang));

// Прямой перевод произвольной пары без ключа.
export const rt = derived(lang, ($lang) => (ru: string, en: string) => ($lang === 'en' ? en : ru));

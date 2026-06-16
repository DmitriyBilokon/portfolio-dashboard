import { writable } from 'svelte/store';
import type { Lang, Theme, Route, Snapshot } from './types';

function persisted<T>(key: string, initial: T) {
  let start = initial;
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) start = JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  const store = writable<T>(start);
  store.subscribe((v) => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  });
  return store;
}

export const lang = persisted<Lang>('v2.lang', 'ru');
export const theme = persisted<Theme>('v2.theme', 'dark');
export const route = writable<Route>('dashboard');

// Выбранный портфель (ключ вкладки) и текущий снапшот.
export const activePortfolio = persisted<string | null>('v2.portfolio', null);
export const snapshot = writable<Snapshot | null>(null);
export const loading = writable<boolean>(true);
export const authedEmail = writable<string | null>(null);

// Применяем тему классом на <html>.
theme.subscribe((v) => {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.classList.toggle('dark', v === 'dark');
  el.classList.toggle('light', v === 'light');
});

lang.subscribe((v) => {
  if (typeof document !== 'undefined') document.documentElement.lang = v;
});

import { get } from 'svelte/store';
import { sb, currentUser, fetchLedgerState } from './supabase';
import { parseSnapshot } from './snapshot';
import { refreshPrices } from './api';
import { snapshot, loading, authedEmail, activePortfolio } from './stores';

// Загрузка реальных данных: сессия → ledger_state → парсинг → живые цены.
export async function loadData(withLiveRefresh = true): Promise<void> {
  loading.set(true);
  try {
    const user = await currentUser();
    authedEmail.set(user?.email ?? null);
    if (!user) {
      snapshot.set(null);
      return;
    }
    const row = await fetchLedgerState(user.id);
    if (!row || !row.snap) {
      snapshot.set(null);
      return;
    }
    let snap = parseSnapshot(row.snap, row.updatedAt);
    snapshot.set(snap);
    ensureActivePortfolio();
    if (withLiveRefresh && snap.portfolios.length) {
      const { snap: fresh } = await refreshPrices(snap);
      snapshot.set(fresh);
    }
  } finally {
    loading.set(false);
  }
}

// Только живое обновление цен текущего снапшота (кнопка «Обновить цены»).
export async function refreshLive(): Promise<number> {
  const snap = get(snapshot);
  if (!snap) return 0;
  const { snap: fresh, updated } = await refreshPrices(snap);
  snapshot.set(fresh);
  return updated;
}

function ensureActivePortfolio(): void {
  const snap = get(snapshot);
  if (!snap || !snap.portfolios.length) return;
  const cur = get(activePortfolio);
  if (!cur || !snap.portfolios.some((p) => p.key === cur)) {
    activePortfolio.set(snap.portfolios[0].key);
  }
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  await loadData();
  return null;
}

export async function signOut(): Promise<void> {
  await sb.auth.signOut();
  authedEmail.set(null);
  snapshot.set(null);
}

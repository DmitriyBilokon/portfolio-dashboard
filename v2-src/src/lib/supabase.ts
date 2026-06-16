import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

// Один общий клиент. Сессия хранится в localStorage самим supabase-js.
export const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user ?? null;
}

// Сырой снапшот пользователя из ledger_state (RLS пускает только владельца).
export async function fetchLedgerState(uid: string): Promise<any | null> {
  const { data, error } = await sb
    .from('ledger_state')
    .select('data, updated_at')
    .eq('user_id', uid)
    .maybeSingle();
  if (error || !data) return null;
  return { snap: data.data, updatedAt: data.updated_at };
}

# Ledger — Cross-Device Sync Setup

Ledger stores your watchlist, portfolio, Finnhub key, and FX cache in
[Supabase](https://supabase.com) (hosted Postgres + Auth) so every device sees the
same data. Your browser talks to Supabase directly — there's no separate server to
run. Data is private to your account and protected by login + Row-Level Security.

> Until you finish steps 1–3, the app keeps working **local-only** (data stays in
> that one browser, exactly like before). Sync turns on once your keys are in place.

---

## 1. Create the Supabase project

1. Sign up at <https://supabase.com> (free tier is plenty) and create a new project.
2. Pick a database password and a region close to you. Wait ~1 min for it to spin up.

## 2. Create the database table

Open **SQL Editor** in the Supabase dashboard, paste this in, and click **Run**:

```sql
-- One row per user holds the entire Ledger state as JSON.
create table public.ledger_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Lock it down: each user can only read/write their own row.
alter table public.ledger_state enable row level security;

create policy "Users manage their own ledger state"
  on public.ledger_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Enable live cross-device updates (Supabase Realtime).
alter publication supabase_realtime add table public.ledger_state;
```

## 3. Add your keys to the app

1. In your project, click **Connect** in the top bar — the panel shows your
   **Project URL** and a copyable **API key**. (Or via the sidebar: the gear
   **Project Settings → Data API** for the URL, and **→ API Keys** for the key.)
2. Grab two values:
   - the **Project URL** (`https://xxxx.supabase.co`), and
   - the public client key, labeled **`anon` `public`** (a long `eyJ…` token) or,
     on newer projects, the **publishable key** (`sb_publishable_…`). Either works.

   ⚠️ Do **not** use the `service_role` / secret key — it bypasses Row-Level
   Security and must never appear in frontend code.
3. Open `index.html`, find this block near the top of the `<script>`, and paste them in:

   ```js
   const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGc...';   // the long "anon public" key
   ```

   Both values are meant to be public — your data is guarded by login + the
   Row-Level Security policy above, not by hiding them.

## 4. Create your login

Since this is just for you, create the single account by hand (no open sign-up):

1. Supabase dashboard → **Authentication → Users → Add user**.
2. Enter your email + a password, and tick **Auto Confirm User** (skips the
   confirmation email).
3. That email/password is what you'll type on each device's sign-in screen.

## 5. Deploy so all devices can reach it

The app is a single static file. Free option on Render:

1. Push this repo to GitHub (already done).
2. <https://render.com> → **New → Static Site** → connect this repo.
3. **Build Command:** leave blank · **Publish Directory:** `.` (the repo root).
4. Deploy. You'll get a URL like `https://ledger-xxxx.onrender.com`.
5. Open that URL on your laptop, phone, etc., sign in once per device — done.

> Any static host works equally well (Netlify, Vercel, Cloudflare Pages,
> GitHub Pages). Render is used here only because you picked the Render family.

---

## How sync behaves

- **Edits push automatically** (debounced ~0.6s) to Supabase after any change.
- **Other open devices update live** via Realtime — no refresh needed.
- **A device that was closed** pulls the latest state when it next loads.
- **Offline:** the app still runs from its localStorage cache and syncs up once
  you're back online and make a change.
- **Conflict rule:** the whole state is one record, so if you edit two devices at
  the *exact* same moment, the last write wins. Fine for a single user; not built
  for simultaneous multi-person editing.

## Notes

- Your Finnhub API key is synced too (convenience: enter it once, works
  everywhere). It lives in your private, login-protected row.
- To wipe everything: the in-app **Reset all data** button clears your synced
  state; deleting the Supabase row does the same.

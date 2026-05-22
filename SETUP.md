# Index Portfolio Dashboard — Cross-Device Sync Setup

The dashboard stores everything you edit — the index tables, your portfolio,
FX rates, column order, theme, and your Finnhub key — in
[Supabase](https://supabase.com) (hosted Postgres + Auth), synced across every
device. Your browser talks to Supabase directly; there's no server to run. Data
is private to your account, protected by login + Row-Level Security.

> The Supabase URL + key are already filled into `app.js`, so **sync is on and
> the app requires login**. If you ever blank those two constants, the app falls
> back to **local-only** (data stays in that one browser, no login).

---

## 1. Create the Supabase project

1. Sign up at <https://supabase.com> (free tier is plenty) and create a project.
2. Pick a database password and a nearby region. Wait ~1 min for it to spin up.

## 2. Create the database table

Open **SQL Editor**, paste this in, and click **Run**:

```sql
-- One row per user holds the entire dashboard state as JSON
-- (indices, portfolio, FX, column order, theme, Finnhub key).
create table public.ledger_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Lock it down: each user can only read/write their own row.
alter table public.ledger_state enable row level security;

create policy "Users manage their own state"
  on public.ledger_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Enable live cross-device updates (Supabase Realtime).
alter publication supabase_realtime add table public.ledger_state;
```

(The table is named `ledger_state` — kept from the original setup. The JSON shape
inside it is schemaless, so the new dashboard data fits without changes.)

## 3. Your keys (already set)

The top of `app.js` already holds your **Project URL** and **publishable key**:

```js
const SUPABASE_URL = 'https://…supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_…';
```

Both are safe to expose — your data is guarded by login + the RLS policy above,
not by hiding them. To point at a different project, click **Connect** in the
Supabase dashboard and paste the new Project URL + anon/publishable key here.
⚠️ Never use the `service_role` / secret key in frontend code.

## 4. Create your login

Single user, no open sign-up — create the account by hand:

1. Supabase → **Authentication → Users → Add user**.
2. Enter your email + password and tick **Auto Confirm User** (skips the
   confirmation email — otherwise sign-in fails with *"Email not confirmed"*).
3. That email/password is what you type on each device's sign-in screen.

## 5. Deploy so all devices can reach it

The app is static files. Free option on Render:

1. Push this repo to GitHub.
2. <https://render.com> → **New → Static Site** → connect this repo.
3. **Build Command:** leave blank · **Publish Directory:** `.` (repo root).
4. Deploy → you get a URL like `https://dashboard-xxxx.onrender.com`.
5. Open it on each device, sign in once — done.

> Any static host works (Netlify, Vercel, Cloudflare Pages, GitHub Pages).

---

## Live prices

The **🔄 Цены** button on the **💼 Портфель** tab refreshes the price column,
recalculates P/L, and syncs the result. There are two ways to source prices.

### Recommended: free Yahoo proxy (covers US + Nordic/EU)

Browsers can't call Yahoo Finance directly (CORS), so [price-proxy.js](price-proxy.js)
is a tiny **Cloudflare Worker** that reads it server-side. Deploy it once (free):

1. <https://dash.cloudflare.com> → **Workers & Pages → Create → Worker**.
2. Replace the starter code with the contents of `price-proxy.js`, click **Deploy**.
3. Copy the `*.workers.dev` URL and test it:
   `https://<your-worker>.workers.dev/?symbols=AAPL,INVE-B.ST,EQNR.OL`
   → should return JSON prices.
4. Paste that URL into **`PRICE_PROXY`** near the top of `app.js`:
   ```js
   const PRICE_PROXY = 'https://<your-worker>.workers.dev';
   ```

Now **🔄 Цены** fetches every holding (US + `.ST`/`.OL`/`.DE`/`.CO`) in one batched
request. Tickers whose symbol differs from the exchange form are mapped in
`SYMBOL_OVERRIDES` in `app.js` — add entries there if a row stays "вручную".

### Fallback: Finnhub (US tickers only)

If `PRICE_PROXY` is blank, the button uses [Finnhub](https://finnhub.io/register)
instead and prompts once for a free API key (then saved + synced). Finnhub's free
tier only covers **US tickers**; EU/Nordic rows keep their manual price. The toast
reports how many updated vs. stayed manual.

## How sync behaves

- **Edits push automatically** (debounced ~0.8s) after any cell edit, delete,
  FX change, column reorder, theme switch, or price refresh.
- **Other open devices update live** via Realtime — no manual refresh.
- **A closed device** pulls the latest state when it next loads.
- **Offline:** the app runs from its `localStorage` cache and syncs up once
  you're back online and make a change.
- **Conflict rule:** the whole state is one record — edit two devices at the
  exact same moment and the last write wins. Fine for a single user.

## Notes

- Delete rows with the **🗑** button (select rows, then confirm).
- **Theme** (🌙/☀️ in the header) is saved per device and synced.
- `index_dashboard.html` is the original single-file source, kept for reference;
  the live app is `index.html` + `styles.css` + `app.js`.

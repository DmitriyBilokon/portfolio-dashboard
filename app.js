// ─── Supabase sync config ───────────────────────────────────────────────
// 1. Create a free project at https://supabase.com
// 2. Connect button (or Project Settings → API Keys / Data API) → copy the
//    "Project URL" and the public "anon"/"publishable" key
// 3. Paste them below. Both values are safe to expose in frontend code;
//    your data is protected by login + Row-Level Security, not by hiding these.
// Until you fill these in, Ledger runs exactly as before (local-only, no sync).
const SUPABASE_URL = 'https://fvrebkwczqmeorytujbn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9CIG7HU54hfBcexS4qr3rQ_HQygVVJC';

const SYNC_ENABLED = SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY.length > 20;
const sb = SYNC_ENABLED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let currentUser = null;       // logged-in Supabase user, or null in local-only mode
let realtimeChannel = null;   // live cross-device update subscription
let pushTimer = null;         // debounce handle for cloud writes
let applyingRemote = false;   // guard: don't re-push state we just pulled

// ─── State + local persistence ──────────────────────────────────────────
let state = {
  apiKey: localStorage.getItem('ledger_apiKey') || '',
  watchlist: JSON.parse(localStorage.getItem('ledger_watchlist') || '[]'),
  portfolio: JSON.parse(localStorage.getItem('ledger_portfolio') || '[]'),
  quotes: {},
  stockCcy: JSON.parse(localStorage.getItem('ledger_stockCcy') || '{}'),
  fxRates: JSON.parse(localStorage.getItem('ledger_fxRates') || 'null') || { SEK: 1 },
  fxUpdated: localStorage.getItem('ledger_fxUpdated') || null,
};

// Migrate v1 entries that lack buyCurrency
state.portfolio.forEach(p => { if (!p.buyCurrency) p.buyCurrency = 'USD'; });

function saveLocal() {
  localStorage.setItem('ledger_apiKey', state.apiKey);
  localStorage.setItem('ledger_watchlist', JSON.stringify(state.watchlist));
  localStorage.setItem('ledger_portfolio', JSON.stringify(state.portfolio));
  localStorage.setItem('ledger_stockCcy', JSON.stringify(state.stockCcy));
  localStorage.setItem('ledger_fxRates', JSON.stringify(state.fxRates));
  if (state.fxUpdated) localStorage.setItem('ledger_fxUpdated', state.fxUpdated);
}

// save() = write the offline cache, then sync up (unless we're mid-pull).
function save() {
  saveLocal();
  if (currentUser && !applyingRemote) schedulePush();
}

// ─── Cloud sync ─────────────────────────────────────────────────────────
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushState, 600);
}

async function pushState() {
  if (!currentUser) return;
  const payload = {
    apiKey: state.apiKey,
    watchlist: state.watchlist,
    portfolio: state.portfolio,
    stockCcy: state.stockCcy,
    fxRates: state.fxRates,
    fxUpdated: state.fxUpdated,
  };
  const { error } = await sb.from('ledger_state')
    .upsert({ user_id: currentUser.id, data: payload, updated_at: new Date().toISOString() });
  if (error) { console.warn('Sync push failed', error); toast('Sync failed — saved locally', true); }
}

async function pullState() {
  if (!currentUser) return;
  const { data, error } = await sb.from('ledger_state')
    .select('data').eq('user_id', currentUser.id).maybeSingle();
  if (error) { console.warn('Sync pull failed', error); return; }
  if (data && data.data && Object.keys(data.data).length) {
    applyRemoteState(data.data);
  } else {
    // Nothing stored in the cloud yet — seed it with whatever this device has.
    pushState();
  }
}

function applyRemoteState(d) {
  applyingRemote = true;
  if (typeof d.apiKey === 'string') state.apiKey = d.apiKey;
  state.watchlist = Array.isArray(d.watchlist) ? d.watchlist : [];
  state.portfolio = Array.isArray(d.portfolio) ? d.portfolio : [];
  state.stockCcy  = d.stockCcy || {};
  state.fxRates   = d.fxRates || { SEK: 1 };
  state.fxUpdated = d.fxUpdated || null;
  state.portfolio.forEach(p => { if (!p.buyCurrency) p.buyCurrency = 'USD'; });
  saveLocal();
  applyingRemote = false;
  if (state.apiKey) document.getElementById('apiBanner').classList.add('hidden');
  updateFxBar();
  renderWatchlist();
  renderPortfolio();
  updateCounts();
}

// Stream changes made on other devices into this one, live.
function subscribeRealtime() {
  if (realtimeChannel) sb.removeChannel(realtimeChannel);
  realtimeChannel = sb.channel('ledger_state_' + currentUser.id)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'ledger_state', filter: 'user_id=eq.' + currentUser.id },
        payload => { if (payload.new && payload.new.data) applyRemoteState(payload.new.data); })
    .subscribe();
}

// ─── Auth ───────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const btn = document.getElementById('authBtn');
  const errEl = document.getElementById('authError');
  errEl.textContent = '';
  btn.disabled = true; btn.textContent = 'Signing in…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Sign in';
  if (error) { errEl.textContent = error.message; return; }
  currentUser = data.user;
  document.getElementById('authPassword').value = '';
  await startApp();
}

async function handleLogout() {
  if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; }
  await sb.auth.signOut();
  currentUser = null;
  document.getElementById('authOverlay').classList.remove('hidden');
}

async function startApp() {
  document.getElementById('authOverlay').classList.add('hidden');
  document.getElementById('acct').innerHTML =
    '<span class="dot" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--up);margin-right:6px;"></span>' +
    'Synced · ' + currentUser.email +
    ' · <button onclick="handleLogout()">Sign out</button> &nbsp;·&nbsp; ';
  await pullState();
  subscribeRealtime();
  init();
}

// On load: enter the app if a session exists, otherwise show the login screen.
// If Supabase keys aren't configured yet, run local-only (original behavior).
async function boot() {
  if (!SYNC_ENABLED) {
    document.getElementById('acct').innerHTML =
      '<span style="color:var(--down)">Sync off — add Supabase keys in app.js</span> &nbsp;·&nbsp; ';
    init();
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await startApp();
  } else {
    document.getElementById('authOverlay').classList.remove('hidden');
  }
}

// ─── App lifecycle ──────────────────────────────────────────────────────
function init() {
  if (state.apiKey) {
    document.getElementById('apiBanner').classList.add('hidden');
    setStatus(true, 'Ready');
  } else {
    setStatus(false, 'API key needed');
  }
  updateFxBar();
  renderWatchlist();
  renderPortfolio();
  updateCounts();
  if (state.apiKey && (state.watchlist.length || state.portfolio.length)) {
    refreshAll();
  } else if (state.apiKey) {
    fetchFxRates();
  }
}

// ─── Finnhub API key management ─────────────────────────────────────────
function saveApiKey() {
  const k = document.getElementById('apiKeyInput').value.trim();
  if (!k) { toast('Please paste your API key', true); return; }
  state.apiKey = k;
  save();
  document.getElementById('apiBanner').classList.add('hidden');
  setStatus(true, 'Ready');
  toast('API key saved');
  refreshAll();
}
function resetApiKey() {
  if (!confirm('Remove your API key? You will need to enter it again.')) return;
  state.apiKey = '';
  save();
  document.getElementById('apiBanner').classList.remove('hidden');
  document.getElementById('apiKeyInput').value = '';
  setStatus(false, 'API key needed');
}

// ─── Tabs ───────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
}

// ─── Watchlist ──────────────────────────────────────────────────────────
function addWatchlistItem(e) {
  e.preventDefault();
  const t = document.getElementById('watchTicker').value.trim().toUpperCase();
  if (!t) return;
  if (state.watchlist.includes(t)) { toast(t + ' is already on your watchlist', true); return; }
  state.watchlist.push(t);
  save();
  document.getElementById('watchTicker').value = '';
  renderWatchlist();
  updateCounts();
  if (state.apiKey) {
    fetchStockCurrency(t).then(() => fetchQuote(t)).then(renderWatchlist);
  }
}
function removeWatchlistItem(t) {
  state.watchlist = state.watchlist.filter(x => x !== t);
  save();
  renderWatchlist();
  updateCounts();
}
function renderWatchlist() {
  const tbody = document.getElementById('watchlistBody');
  if (state.watchlist.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">— Your watchlist is empty —</td></tr>';
    return;
  }
  tbody.innerHTML = state.watchlist.map(t => {
    const q = state.quotes[t];
    const ccy = state.stockCcy[t] || '';
    if (!q) return `<tr class="loading-row"><td><span class="ticker">${t}</span></td><td colspan="5">loading…</td><td><button class="remove-btn" onclick="removeWatchlistItem('${t}')">×</button></td></tr>`;
    if (q.error) return `<tr class="error-row"><td><span class="ticker">${t}</span></td><td colspan="5">${q.error}</td><td><button class="remove-btn" onclick="removeWatchlistItem('${t}')">×</button></td></tr>`;
    const dir = q.d > 0 ? 'up' : q.d < 0 ? 'down' : 'neutral';
    const sign = q.d > 0 ? '+' : '';
    return `
      <tr>
        <td><span class="ticker">${t}</span><span class="ccy-tag">${ccy}</span></td>
        <td class="price">${fmtNum(q.c, 2)}</td>
        <td class="${dir}">${sign}${fmtNum(q.d, 2)}</td>
        <td><span class="change-pill ${dir}">${sign}${q.dp.toFixed(2)}%</span></td>
        <td class="neutral">${fmtNum(q.h, 2)}</td>
        <td class="neutral">${fmtNum(q.l, 2)}</td>
        <td><button class="remove-btn" onclick="removeWatchlistItem('${t}')">×</button></td>
      </tr>`;
  }).join('');
}

// ─── Portfolio ──────────────────────────────────────────────────────────
function addPortfolioItem(e) {
  e.preventDefault();
  const t = document.getElementById('pfTicker').value.trim().toUpperCase();
  const shares = parseFloat(document.getElementById('pfShares').value);
  const buyPrice = parseFloat(document.getElementById('pfBuyPrice').value);
  const buyCurrency = document.getElementById('pfCurrency').value;
  if (!t || isNaN(shares) || isNaN(buyPrice) || shares <= 0 || buyPrice <= 0) {
    toast('Fill in ticker, shares, and buy price', true);
    return;
  }
  state.portfolio.push({ id: Date.now(), ticker: t, shares, buyPrice, buyCurrency });
  save();
  document.getElementById('pfTicker').value = '';
  document.getElementById('pfShares').value = '';
  document.getElementById('pfBuyPrice').value = '';
  renderPortfolio();
  updateCounts();
  if (state.apiKey) {
    fetchStockCurrency(t).then(() => fetchQuote(t)).then(renderPortfolio);
  }
}
function removePortfolioItem(id) {
  state.portfolio = state.portfolio.filter(p => p.id !== id);
  save();
  renderPortfolio();
  updateCounts();
}

function toSEK(amount, fromCcy) {
  if (fromCcy === 'SEK') return amount;
  const rate = state.fxRates[fromCcy];
  if (!rate) return null;
  return amount * rate;
}

function renderPortfolio() {
  const tbody = document.getElementById('portfolioBody');
  const summary = document.getElementById('portfolioSummary');

  if (state.portfolio.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">— No positions yet —</td></tr>';
    summary.style.display = 'none';
    return;
  }
  summary.style.display = 'grid';

  let totalValueSEK = 0, totalCostSEK = 0, hasAll = true;

  tbody.innerHTML = state.portfolio.map(p => {
    const q = state.quotes[p.ticker];
    const stockCcy = state.stockCcy[p.ticker] || 'USD';
    const costNative = p.shares * p.buyPrice;
    const costSEK = toSEK(costNative, p.buyCurrency);
    if (costSEK !== null) totalCostSEK += costSEK;

    if (!q || q.error) {
      hasAll = false;
      const msg = q && q.error ? q.error : 'loading…';
      return `
        <tr class="${q && q.error ? 'error-row' : 'loading-row'}">
          <td><span class="ticker">${p.ticker}</span></td>
          <td>${fmtNum(p.shares, 4)}</td>
          <td>${fmtNum(p.buyPrice, 2)} <span class="ccy-tag">${p.buyCurrency}</span></td>
          <td colspan="3">${msg}</td>
          <td>${costSEK !== null ? fmtNum(costSEK, 0) + ' kr' : ''}</td>
          <td><button class="remove-btn" onclick="removePortfolioItem(${p.id})">×</button></td>
        </tr>`;
    }

    const valueNative = p.shares * q.c;
    const valueSEK = toSEK(valueNative, stockCcy);
    if (valueSEK === null || costSEK === null) hasAll = false;
    else totalValueSEK += valueSEK;

    const plSEK = (valueSEK !== null && costSEK !== null) ? valueSEK - costSEK : null;
    const plPct = (plSEK !== null && costSEK > 0) ? (plSEK / costSEK) * 100 : null;
    const dir = plSEK > 0 ? 'up' : plSEK < 0 ? 'down' : 'neutral';
    const sign = plSEK > 0 ? '+' : '';

    return `
      <tr>
        <td><span class="ticker">${p.ticker}</span><span class="ccy-tag">${stockCcy}</span></td>
        <td>${fmtNum(p.shares, 4)}</td>
        <td class="neutral">${fmtNum(p.buyPrice, 2)} <span class="ccy-tag">${p.buyCurrency}</span></td>
        <td class="price">${fmtNum(q.c, 2)} <span class="ccy-tag">${stockCcy}</span></td>
        <td class="price">${valueSEK !== null ? fmtNum(valueSEK, 0) + ' kr' : '—'}</td>
        <td class="${dir}">${plSEK !== null ? sign + fmtNum(plSEK, 0) + ' kr' : '—'}</td>
        <td>${plPct !== null ? `<span class="change-pill ${dir}">${sign}${plPct.toFixed(2)}%</span>` : '—'}</td>
        <td><button class="remove-btn" onclick="removePortfolioItem(${p.id})">×</button></td>
      </tr>`;
  }).join('');

  if (hasAll) {
    const totalPL = totalValueSEK - totalCostSEK;
    const totalPLPct = totalCostSEK > 0 ? (totalPL / totalCostSEK) * 100 : 0;
    const dir = totalPL > 0 ? 'up' : totalPL < 0 ? 'down' : 'neutral';
    const sign = totalPL > 0 ? '+' : '';
    document.getElementById('sumValue').textContent = fmtNum(totalValueSEK, 0) + ' kr';
    document.getElementById('sumCost').textContent = fmtNum(totalCostSEK, 0) + ' kr';
    const plEl = document.getElementById('sumPL');
    plEl.textContent = sign + fmtNum(totalPL, 0) + ' kr';
    plEl.className = 'summary-value ' + dir;
    const pctEl = document.getElementById('sumPLPct');
    pctEl.textContent = sign + totalPLPct.toFixed(2) + '%';
    pctEl.className = 'summary-sub ' + dir;
  } else {
    document.getElementById('sumValue').textContent = '—';
    document.getElementById('sumCost').textContent = fmtNum(totalCostSEK, 0) + ' kr';
    document.getElementById('sumPL').textContent = '—';
    document.getElementById('sumPLPct').textContent = '—';
  }
}

// ─── Market data (Finnhub quotes + Frankfurter FX) ──────────────────────
async function fetchFxRates() {
  try {
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=SEK&symbols=USD,EUR,NOK');
    if (!r.ok) throw new Error('FX fetch returned ' + r.status);
    const data = await r.json();
    if (!data.rates) throw new Error('FX response missing rates');
    state.fxRates = {
      SEK: 1,
      USD: 1 / data.rates.USD,
      EUR: 1 / data.rates.EUR,
      NOK: 1 / data.rates.NOK,
    };
    state.fxUpdated = data.date;
    save();
    updateFxBar();
  } catch (err) {
    console.warn('FX rates fetch failed', err);
    toast('Could not load FX rates: ' + err.message, true);
  }
}

function updateFxBar() {
  const r = state.fxRates || {};
  document.getElementById('fx-usd').textContent = r.USD ? r.USD.toFixed(3) : '—';
  document.getElementById('fx-eur').textContent = r.EUR ? r.EUR.toFixed(3) : '—';
  document.getElementById('fx-nok').textContent = r.NOK ? r.NOK.toFixed(3) : '—';
}

async function fetchStockCurrency(ticker) {
  if (state.stockCcy[ticker]) return;
  try {
    const r = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(state.apiKey)}`);
    if (!r.ok) {
      state.stockCcy[ticker] = guessCurrencyFromTicker(ticker);
      save();
      return;
    }
    const data = await r.json();
    if (data && data.currency) {
      state.stockCcy[ticker] = data.currency;
    } else {
      state.stockCcy[ticker] = guessCurrencyFromTicker(ticker);
    }
    save();
  } catch (err) {
    state.stockCcy[ticker] = guessCurrencyFromTicker(ticker);
    save();
  }
}

function guessCurrencyFromTicker(t) {
  if (t.endsWith('.ST')) return 'SEK';
  if (t.endsWith('.OL')) return 'NOK';
  if (t.endsWith('.PA') || t.endsWith('.DE') || t.endsWith('.MI') || t.endsWith('.AS') || t.endsWith('.MC') || t.endsWith('.HE') || t.endsWith('.LS') || t.endsWith('.BR')) return 'EUR';
  if (t.endsWith('.CO')) return 'DKK';
  if (t.endsWith('.L') || t.endsWith('.LON')) return 'GBP';
  return 'USD';
}

async function fetchQuote(ticker) {
  if (!state.apiKey) return;
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(state.apiKey)}`);
    if (!r.ok) {
      const errText = r.status === 401 ? 'invalid API key' : `error ${r.status}`;
      state.quotes[ticker] = { error: errText };
      return;
    }
    const data = await r.json();
    if ((data.c === 0 || data.c === null) && (data.pc === 0 || data.pc === null)) {
      state.quotes[ticker] = { error: 'symbol not found' };
    } else {
      state.quotes[ticker] = data;
    }
  } catch (err) {
    state.quotes[ticker] = { error: 'network error' };
  }
}

async function refreshAll() {
  if (!state.apiKey) { toast('Add your API key first', true); return; }
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true;
  btn.textContent = '↻ Loading…';
  setStatus(true, 'Fetching…');

  fetchFxRates();

  const tickers = new Set([
    ...state.watchlist,
    ...state.portfolio.map(p => p.ticker)
  ]);

  for (const t of tickers) {
    await fetchStockCurrency(t);
    await fetchQuote(t);
    renderWatchlist();
    renderPortfolio();
  }

  const now = new Date();
  document.getElementById('lastUpdate').textContent =
    'Last updated · ' + now.toLocaleString('sv-SE') +
    (state.fxUpdated ? '  ·  FX as of ' + state.fxUpdated : '');
  setStatus(true, 'Live');
  btn.disabled = false;
  btn.textContent = '↻ Refresh';
}

// ─── Small helpers ──────────────────────────────────────────────────────
function fmtNum(n, decimals) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (decimals === undefined) decimals = 2;
  return n.toLocaleString('sv-SE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function updateCounts() {
  document.getElementById('watchlist-count').textContent = String(state.watchlist.length).padStart(2, '0');
  document.getElementById('portfolio-count').textContent = String(state.portfolio.length).padStart(2, '0');
}
function setStatus(ok, text) {
  const dot = document.querySelector('#status .dot');
  document.getElementById('status-text').textContent = text;
  if (ok) dot.classList.remove('stale'); else dot.classList.add('stale');
}
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => t.className = 'toast', 2600);
}
function clearAll() {
  if (!confirm('Erase your watchlist and portfolio? This cannot be undone.')) return;
  state.watchlist = [];
  state.portfolio = [];
  state.quotes = {};
  state.stockCcy = {};
  save();
  renderWatchlist();
  renderPortfolio();
  updateCounts();
  toast('All data cleared');
}

boot();

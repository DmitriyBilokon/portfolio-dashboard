<script lang="ts">
  import { onMount } from 'svelte';
  import { route, snapshot, loading, authedEmail, theme, lang } from './lib/stores';
  import { loadData } from './lib/data';
  import { sb } from './lib/supabase';
  import { t } from './lib/i18n';
  import Sidebar from './components/Sidebar.svelte';
  import Topbar from './components/Topbar.svelte';
  import Toasts from './components/Toasts.svelte';
  import Dashboard from './routes/Dashboard.svelte';
  import Holdings from './routes/Holdings.svelte';
  import Sectors from './routes/Sectors.svelte';
  import Diversification from './routes/Diversification.svelte';
  import Trades from './routes/Trades.svelte';
  import Login from './routes/Login.svelte';

  let menuOpen = false;

  onMount(() => {
    // первичная синхронизация темы/языка с <html>
    theme.update((v) => v);
    lang.update((v) => v);
    loadData();
    const { data } = sb.auth.onAuthStateChange((_event, session) => {
      authedEmail.set(session?.user?.email ?? null);
    });
    return () => data.subscription.unsubscribe();
  });
</script>

<div class="flex min-h-screen">
  <!-- Боковая навигация: фикс на десктопе, выезжает на мобиле -->
  <aside class="hidden w-60 shrink-0 border-r border-border bg-surface lg:block">
    <div class="sticky top-0"><Sidebar /></div>
  </aside>

  {#if menuOpen}
    <div class="fixed inset-0 z-30 bg-black/50 lg:hidden" on:click={() => (menuOpen = false)} role="presentation"></div>
    <aside class="fixed inset-y-0 left-0 z-40 w-60 border-r border-border bg-surface lg:hidden">
      <Sidebar onnav={() => (menuOpen = false)} />
    </aside>
  {/if}

  <div class="flex min-w-0 flex-1 flex-col">
    <Topbar onmenu={() => (menuOpen = true)} />
    <main class="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-5 sm:py-6">
      {#if $loading && !$snapshot}
        <div class="grid place-items-center py-24 text-dim">{$t('loading')}</div>
      {:else if !$authedEmail}
        <Login />
      {:else if $route === 'holdings'}
        <Holdings />
      {:else if $route === 'sectors'}
        <Sectors />
      {:else if $route === 'divers'}
        <Diversification />
      {:else if $route === 'trades'}
        <Trades />
      {:else}
        <Dashboard />
      {/if}
    </main>
  </div>
</div>

<Toasts />

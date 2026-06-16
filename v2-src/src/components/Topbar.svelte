<script lang="ts">
  import { snapshot, activePortfolio, theme, lang, authedEmail } from '../lib/stores';
  import { t } from '../lib/i18n';
  import { refreshLive, signOut } from '../lib/data';
  import { toast } from '../lib/toast';

  export let onmenu: () => void = () => {};
  let refreshing = false;

  async function doRefresh() {
    refreshing = true;
    try {
      const n = await refreshLive();
      toast(`🔄 ${n} ${$t('updated')}`);
    } catch {
      toast($t('refreshFail'), true);
    } finally {
      refreshing = false;
    }
  }
</script>

<header
  class="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-bg px-3 py-2.5 backdrop-blur sm:px-5"
>
  <button class="btn-ghost lg:hidden" on:click={onmenu} aria-label="menu">☰</button>

  {#if $snapshot && $snapshot.portfolios.length}
    <select
      class="btn max-w-[46vw] truncate sm:max-w-xs"
      bind:value={$activePortfolio}
    >
      {#each $snapshot.portfolios as p}
        <option value={p.key}>{p.label}</option>
      {/each}
    </select>
  {/if}

  <div class="ml-auto flex items-center gap-1.5">
    {#if $snapshot}
      <button class="btn" on:click={doRefresh} disabled={refreshing}>
        {refreshing ? '⏳' : '🔄'}<span class="hidden sm:inline">{$t('refresh')}</span>
      </button>
    {/if}
    <button
      class="btn-ghost"
      title="Тема"
      on:click={() => theme.update((v) => (v === 'dark' ? 'light' : 'dark'))}
    >
      {$theme === 'dark' ? '☀' : '☾'}
    </button>
    <button class="btn-ghost" on:click={() => lang.update((v) => (v === 'ru' ? 'en' : 'ru'))}>
      {$lang === 'ru' ? 'EN' : 'RU'}
    </button>
    {#if $authedEmail}
      <button class="btn-ghost hidden sm:inline-flex" title={$authedEmail} on:click={signOut}>
        {$t('signOut')}
      </button>
    {/if}
  </div>
</header>

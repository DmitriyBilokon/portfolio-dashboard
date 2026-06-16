<script lang="ts">
  import { route } from '../lib/stores';
  import { t } from '../lib/i18n';
  import type { Route } from '../lib/types';

  const items: { k: Route; icon: string; key: string }[] = [
    { k: 'dashboard', icon: '◧', key: 'dashboard' },
    { k: 'holdings', icon: '☷', key: 'holdings' },
    { k: 'sectors', icon: '⬡', key: 'sectors' },
    { k: 'divers', icon: '◉', key: 'diversification' },
    { k: 'trades', icon: '↺', key: 'trades' },
  ];
  export let onnav: () => void = () => {};
</script>

<nav class="flex flex-col gap-1 p-3">
  <div class="mb-3 flex items-center gap-2 px-2 py-1">
    <span class="grid h-8 w-8 place-items-center rounded-lg text-accent" style="background: color-mix(in srgb, var(--accent) 16%, transparent)">◆</span>
    <span class="font-semibold tracking-tight">Портфель <span class="text-accent">v2</span></span>
  </div>
  {#each items as it}
    <button
      class="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors"
      class:bg-surface2={$route === it.k}
      class:text-txt={$route === it.k}
      class:text-dim={$route !== it.k}
      on:click={() => {
        route.set(it.k);
        onnav();
      }}
    >
      <span class="w-5 text-center text-base" class:text-accent={$route === it.k}>{it.icon}</span>
      {$t(it.key)}
    </button>
  {/each}
</nav>

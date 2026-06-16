<script lang="ts">
  import { snapshot, activePortfolio } from '../lib/stores';
  import { t } from '../lib/i18n';
  import { statsFor } from '../lib/calc';
  import Card from '../components/Card.svelte';
  import HoldingsTable from '../components/HoldingsTable.svelte';

  let query = '';
  $: snap = $snapshot;
  $: pf = snap?.portfolios.find((p) => p.key === $activePortfolio) ?? snap?.portfolios[0] ?? null;
  $: stats = pf && snap ? statsFor(pf, snap.fx) : null;
</script>

{#if pf && stats}
  <Card title={$t('holdings')} subtitle={pf.label + ' · ' + stats.count + ' ' + $t('positions')}>
    <svelte:fragment slot="head">
      <input
        class="btn w-40 sm:w-56"
        type="search"
        placeholder={$t('search')}
        bind:value={query}
      />
    </svelte:fragment>
    <HoldingsTable positions={pf.positions} total={stats.total} {query} />
  </Card>
{:else}
  <div class="grid place-items-center py-20 text-dim">{$t('noData')}</div>
{/if}

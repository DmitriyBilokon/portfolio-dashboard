<script lang="ts">
  import { snapshot, activePortfolio } from '../lib/stores';
  import { t, rt } from '../lib/i18n';
  import { statsFor, allocBySector, allocByType, allocByCurrency, topMovers } from '../lib/calc';
  import { money, fmt, pct, deltaClass } from '../lib/format';
  import StatCard from '../components/StatCard.svelte';
  import Card from '../components/Card.svelte';
  import AllocationBars from '../components/AllocationBars.svelte';

  $: snap = $snapshot;
  $: pf = snap?.portfolios.find((p) => p.key === $activePortfolio) ?? snap?.portfolios[0] ?? null;
  $: stats = pf && snap ? statsFor(pf, snap.fx) : null;
  $: movers = pf ? topMovers(pf, 6) : [];
</script>

{#if pf && stats && snap}
  <div class="space-y-5">
    <!-- KPI -->
    <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard
        label={$t('netWorth')}
        value={money(stats.total)}
        sub={$t('positions') + ': ' + stats.count}
      />
      <StatCard
        label={$t('dayChange')}
        value={pct(stats.dayChangePct)}
        accent={stats.dayChangePct >= 0 ? 'up' : 'down'}
        sub={(stats.dayChangeSEK >= 0 ? '+' : '') + money(stats.dayChangeSEK)}
      />
      <StatCard
        label={$t('totalPL')}
        value={(stats.plSEK >= 0 ? '+' : '') + money(stats.plSEK)}
        accent={stats.plSEK >= 0 ? 'up' : 'down'}
        sub={pct(stats.plPct) + ' · ' + $t('invested') + ' ' + money(stats.investedSEK)}
      />
      <StatCard
        label={$rt('Средняя доля', 'Avg weight')}
        value={fmt(100 / stats.count, 1) + '%'}
        sub={$rt('крупнейшая', 'largest') +
          ': ' +
          (pf.positions.slice().sort((a, b) => b.valSEK - a.valSEK)[0]?.ticker ?? '—')}
      />
    </div>

    <!-- Аллокации + лидеры дня -->
    <div class="grid gap-4 lg:grid-cols-3">
      <Card title={$t('bySector')}>
        <AllocationBars slices={allocBySector(pf)} />
      </Card>
      <Card title={$t('byType')}>
        <AllocationBars slices={allocByType(pf)} />
      </Card>
      <Card title={$t('byCurrency')}>
        <AllocationBars slices={allocByCurrency(pf)} />
      </Card>
    </div>

    <Card title={$t('topMovers')}>
      <ul class="divide-y divide-border">
        {#each movers as m}
          <li class="flex items-center gap-3 py-2.5">
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium text-txt">{m.name}</div>
              <div class="text-xs text-dim">{m.ticker} · {m.sector}</div>
            </div>
            <div class="tnum text-sm text-dim">{fmt(m.price, 2)} {m.ccy}</div>
            <div class="tnum w-20 text-right text-sm font-semibold {deltaClass(m.dayPct)}">
              {pct(m.dayPct)}
            </div>
          </li>
        {/each}
        {#if !movers.length}
          <li class="py-6 text-center text-sm text-dim">{$t('noData')}</li>
        {/if}
      </ul>
    </Card>
  </div>
{:else}
  <div class="grid place-items-center py-20 text-dim">{$t('noData')}</div>
{/if}

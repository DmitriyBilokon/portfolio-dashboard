<script lang="ts">
  import { snapshot, activePortfolio } from '../lib/stores';
  import { t, rt } from '../lib/i18n';
  import { diversification, allocBySector } from '../lib/calc';
  import { fmt } from '../lib/format';
  import Card from '../components/Card.svelte';
  import StatCard from '../components/StatCard.svelte';

  $: snap = $snapshot;
  $: pf = snap?.portfolios.find((p) => p.key === $activePortfolio) ?? snap?.portfolios[0] ?? null;
  $: d = pf ? diversification(pf) : null;

  // Эффективное число позиций = 1/HHI (сколько «равновесных» бумаг по концентрации).
  $: effN = d && d.hhi > 0 ? 1 / d.hhi : 0;
  $: verdict = !d
    ? ''
    : d.hhi < 0.12
      ? $t('wellDiversified')
      : d.hhi < 0.2
        ? $t('moderate')
        : $t('concentrated');
  $: vClass = !d ? '' : d.hhi < 0.12 ? 'text-up' : d.hhi < 0.2 ? 'text-dim' : 'text-down';
</script>

{#if pf && d}
  <div class="space-y-5">
    <Card title={$t('concentration')} subtitle={pf.label}>
      <div class="flex items-baseline gap-3">
        <span class="text-2xl font-bold {vClass}">{verdict}</span>
        <span class="text-sm text-dim tnum"
          >HHI {d.hhi.toFixed(3)} · {$rt('эфф. число', 'eff. count')} ≈ {fmt(effN, 1)}</span
        >
      </div>
    </Card>

    <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard label={$t('positions')} value={fmt(d.count)} />
      <StatCard
        label={$t('topHolding')}
        value={d.topWeight.toFixed(1) + '%'}
        accent={d.topWeight >= 25 ? 'down' : 'none'}
      />
      <StatCard label={$t('top3')} value={d.top3Weight.toFixed(1) + '%'} />
      <StatCard
        label={$t('sectorsN')}
        value={fmt(d.sectorCount)}
        sub={d.largestSector + ' · ' + d.largestSectorPct.toFixed(0) + '%'}
      />
    </div>

    <Card title={$t('bySector')}>
      <div class="space-y-2">
        {#each allocBySector(pf) as s}
          <div class="flex items-center gap-3">
            <div class="w-36 shrink-0 truncate text-sm text-txt">{s.label}</div>
            <div class="h-2.5 flex-1 overflow-hidden rounded-full bg-surface2">
              <div
                class="h-full rounded-full"
                style="width:{s.pct}%; background: color-mix(in srgb, var(--accent) 60%, transparent)"
              ></div>
            </div>
            <div class="w-14 shrink-0 text-right text-sm font-semibold tnum">{s.pct.toFixed(1)}%</div>
          </div>
        {/each}
      </div>
    </Card>
  </div>
{:else}
  <div class="grid place-items-center py-20 text-dim">{$t('noData')}</div>
{/if}

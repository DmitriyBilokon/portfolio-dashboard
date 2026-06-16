<script lang="ts">
  import { snapshot, activePortfolio } from '../lib/stores';
  import { t } from '../lib/i18n';
  import { sectorPerf } from '../lib/calc';
  import { money, fmt, pct, deltaClass } from '../lib/format';
  import Card from '../components/Card.svelte';
  import AllocationBars from '../components/AllocationBars.svelte';

  $: snap = $snapshot;
  $: pf = snap?.portfolios.find((p) => p.key === $activePortfolio) ?? snap?.portfolios[0] ?? null;
  $: rows = pf ? sectorPerf(pf) : [];
  $: maxPct = rows.reduce((m, r) => Math.max(m, r.pct), 0) || 1;
</script>

{#if pf}
  <div class="space-y-5">
    <Card title={$t('allocation')} subtitle={$t('bySector')}>
      <AllocationBars slices={rows.map((r) => ({ label: r.label, valSEK: r.valSEK, pct: r.pct }))} max={12} />
    </Card>

    <Card title={$t('sectors')} subtitle={pf.label}>
      <div class="space-y-2.5">
        {#each rows as r}
          <div class="flex items-center gap-3">
            <div class="w-32 shrink-0 truncate text-sm text-txt" title={r.label}>{r.label}</div>
            <div class="relative h-6 flex-1 overflow-hidden rounded-md bg-surface2">
              <div
                class="h-full rounded-md"
                style="width:{(r.pct / maxPct) * 100}%; background: color-mix(in srgb, var(--accent) 55%, transparent)"
              ></div>
            </div>
            <div class="w-14 shrink-0 text-right text-sm font-semibold tnum">{r.pct.toFixed(1)}%</div>
            <div class="w-24 shrink-0 text-right text-sm tnum text-dim">{money(r.valSEK)}</div>
            <div class="w-16 shrink-0 text-right text-sm font-semibold tnum {deltaClass(r.dayPct)}">
              {r.dayPct == null ? '—' : pct(r.dayPct)}
            </div>
            <div class="hidden w-12 shrink-0 text-right text-xs tnum text-faint sm:block">
              {fmt(r.count)} шт
            </div>
          </div>
        {/each}
      </div>
    </Card>
  </div>
{:else}
  <div class="grid place-items-center py-20 text-dim">{$t('noData')}</div>
{/if}

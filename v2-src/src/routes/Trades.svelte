<script lang="ts">
  import { snapshot, activePortfolio } from '../lib/stores';
  import { t, rt } from '../lib/i18n';
  import { tradesFor } from '../lib/calc';
  import { money, fmt, deltaClass } from '../lib/format';
  import Card from '../components/Card.svelte';

  $: snap = $snapshot;
  $: pf = snap?.portfolios.find((p) => p.key === $activePortfolio) ?? snap?.portfolios[0] ?? null;
  $: res =
    snap && pf ? tradesFor(snap.trades, pf.key, snap.fx) : { rows: [], realizedSEK: 0, hasSell: false };
</script>

<Card title={$t('history')} subtitle={pf?.label ?? ''}>
  <svelte:fragment slot="head">
    {#if res.hasSell}
      <span class="text-sm text-dim">
        {$t('realizedPL')}:
        <b class={res.realizedSEK >= 0 ? 'text-up' : 'text-down'}>
          {res.realizedSEK >= 0 ? '+' : ''}{money(res.realizedSEK)}
        </b>
      </span>
    {/if}
  </svelte:fragment>

  {#if res.rows.length}
    <ul class="divide-y divide-border">
      {#each res.rows as tr}
        <li class="flex items-center gap-3 py-2.5">
          <span
            class="w-24 shrink-0 text-xs font-semibold"
            class:text-up={tr.act === 'buy'}
            class:text-down={tr.act === 'sell'}
          >
            {tr.act === 'sell' ? '🔴 ' + $rt('Продажа', 'Sell') : '🟢 ' + $rt('Покупка', 'Buy')}
          </span>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium text-txt">{tr.name || tr.ticker}</div>
            <div class="text-xs text-dim">
              {tr.ticker} · {tr.date}{tr.feeNative
                ? ` · ${$t('fee')} ${fmt(tr.feeNative, 1)} ${tr.ccy}`
                : ''}
            </div>
          </div>
          <div class="shrink-0 text-right text-sm tnum text-dim">
            {fmt(tr.qty)} × {fmt(tr.price, 2)} {tr.ccy}
          </div>
          <div class="w-24 shrink-0 text-right text-sm font-semibold tnum {deltaClass(tr.plSEK)}">
            {tr.plSEK != null ? (tr.plSEK >= 0 ? '+' : '') + money(tr.plSEK) : '—'}
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="py-10 text-center text-sm text-dim">{$t('noTrades')}</div>
  {/if}
</Card>

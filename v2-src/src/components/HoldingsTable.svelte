<script lang="ts">
  import type { Position } from '../lib/types';
  import { fmt, money, deltaClass, pct } from '../lib/format';
  import { t } from '../lib/i18n';
  import Delta from './Delta.svelte';

  export let positions: Position[] = [];
  export let total = 0;
  export let query = '';

  type Key = 'name' | 'qty' | 'price' | 'dayPct' | 'valSEK' | 'weight' | 'upside';
  let sortKey: Key = 'valSEK';
  let dir: 1 | -1 = -1;

  function upsideOf(p: Position): number | null {
    if (p.target == null || !(p.price > 0)) return null;
    return (p.target / p.price - 1) * 100;
  }

  function sortBy(k: Key) {
    if (sortKey === k) dir = (dir * -1) as 1 | -1;
    else {
      sortKey = k;
      dir = k === 'name' ? 1 : -1;
    }
  }

  function valOf(p: Position, k: Key): number | string {
    switch (k) {
      case 'name':
        return p.name.toLowerCase();
      case 'qty':
        return p.qty;
      case 'price':
        return p.price;
      case 'dayPct':
        return p.dayPct ?? -Infinity;
      case 'valSEK':
        return p.valSEK;
      case 'weight':
        return p.valSEK;
      case 'upside':
        return upsideOf(p) ?? -Infinity;
    }
  }

  $: rows = positions
    .filter((p) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return p.name.toLowerCase().includes(q) || p.ticker.toLowerCase().includes(q);
    })
    .slice()
    .sort((a, b) => {
      const av = valOf(a, sortKey),
        bv = valOf(b, sortKey);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

  $: cols = [
    { k: 'name' as Key, label: $t('name'), align: 'text-left' },
    { k: 'qty' as Key, label: $t('qty'), align: 'text-right' },
    { k: 'price' as Key, label: $t('price'), align: 'text-right' },
    { k: 'dayPct' as Key, label: $t('dayChange'), align: 'text-right' },
    { k: 'valSEK' as Key, label: $t('value'), align: 'text-right' },
    { k: 'weight' as Key, label: $t('weight'), align: 'text-right' },
    { k: 'upside' as Key, label: $t('upside'), align: 'text-right' },
  ];
</script>

<div class="overflow-x-auto">
  <table class="w-full border-collapse text-sm">
    <thead>
      <tr class="border-b border-border text-faint">
        {#each cols as col}
          <th
            class="cursor-pointer select-none whitespace-nowrap px-3 py-2 font-medium {col.align}"
            on:click={() => sortBy(col.k)}
          >
            <span class="label">{col.label}</span>
            {#if sortKey === col.k}<span class="text-accent">{dir === -1 ? '↓' : '↑'}</span>{/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as p (p.ticker + p.ccy)}
        <tr class="border-b border-border hover:bg-surface2">
          <td class="px-3 py-2.5">
            <div class="font-medium text-txt">{p.name}</div>
            <div class="text-xs text-dim">{p.ticker} · {p.sector}</div>
          </td>
          <td class="px-3 py-2.5 text-right tnum text-dim">{fmt(p.qty)}</td>
          <td class="px-3 py-2.5 text-right tnum">{fmt(p.price, 2)} <span class="text-faint">{p.ccy}</span></td>
          <td class="px-3 py-2.5 text-right">
            <span class="tnum {deltaClass(p.dayPct)}">{p.dayPct == null ? '—' : pct(p.dayPct)}</span>
          </td>
          <td class="px-3 py-2.5 text-right tnum font-semibold">{money(p.valSEK)}</td>
          <td class="px-3 py-2.5 text-right tnum text-dim">
            {total > 0 ? ((p.valSEK / total) * 100).toFixed(1) + '%' : '—'}
          </td>
          <td class="px-3 py-2.5 text-right">
            {#if upsideOf(p) == null}
              <span class="text-faint">—</span>
            {:else}
              <Delta value={upsideOf(p)} />
            {/if}
          </td>
        </tr>
      {/each}
      {#if !rows.length}
        <tr><td colspan="7" class="px-3 py-8 text-center text-dim">{$t('noData')}</td></tr>
      {/if}
    </tbody>
  </table>
</div>

<script lang="ts">
  import type { AllocSlice } from '../lib/calc';
  import { money } from '../lib/format';
  export let slices: AllocSlice[] = [];
  export let max = 8;

  const PALETTE = [
    '#6e8bff',
    '#2fd07a',
    '#ffb454',
    '#ff7a90',
    '#56c8d8',
    '#b08bff',
    '#e8c65c',
    '#7ed957',
    '#ff9f6e',
    '#8a93a8',
  ];

  $: shown = (() => {
    if (slices.length <= max) return slices;
    const head = slices.slice(0, max - 1);
    const rest = slices.slice(max - 1);
    const restVal = rest.reduce((s, x) => s + x.valSEK, 0);
    const restPct = rest.reduce((s, x) => s + x.pct, 0);
    return [...head, { label: 'Прочее', valSEK: restVal, pct: restPct }];
  })();
</script>

<!-- Тонкая stacked-полоса сверху + список — компактно и читаемо. -->
<div class="mb-3 flex h-2.5 overflow-hidden rounded-full bg-surface2">
  {#each shown as s, i}
    <div
      class="h-full"
      style="width:{s.pct}%; background:{PALETTE[i % PALETTE.length]}"
      title="{s.label} · {s.pct.toFixed(1)}%"
    ></div>
  {/each}
</div>

<ul class="space-y-1.5">
  {#each shown as s, i}
    <li class="flex items-center gap-2 text-sm">
      <span
        class="h-2.5 w-2.5 shrink-0 rounded-sm"
        style="background:{PALETTE[i % PALETTE.length]}"
      ></span>
      <span class="min-w-0 flex-1 truncate text-txt">{s.label}</span>
      <span class="tnum text-dim">{money(s.valSEK)}</span>
      <span class="tnum w-12 text-right font-semibold text-txt">{s.pct.toFixed(1)}%</span>
    </li>
  {/each}
</ul>

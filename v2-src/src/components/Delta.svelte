<script lang="ts">
  import { pct, deltaClass } from '../lib/format';
  export let value: number | null;
  export let suffix = '';
  export let pill = false;
  export let dec = 1;
</script>

{#if pill}
  <span
    class="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-semibold tnum {deltaClass(
      value,
    )}"
    style="background: color-mix(in srgb, currentColor 14%, transparent)"
  >
    {value != null && value > 0 ? '▲' : value != null && value < 0 ? '▼' : '•'}
    {pct(value, dec, false)}{suffix}
  </span>
{:else}
  <span class="tnum font-semibold {deltaClass(value)}">{pct(value, dec)}{suffix}</span>
{/if}

<script lang="ts">
  export let label: string;
  export let value: string;
  export let sub: string = '';
  export let accent: 'up' | 'down' | 'none' = 'none';
</script>

<div class="card p-4 sm:p-5">
  <div class="label">{label}</div>
  <div
    class="mt-1.5 text-2xl font-bold tnum sm:text-3xl"
    class:text-up={accent === 'up'}
    class:text-down={accent === 'down'}
  >
    {value}
  </div>
  {#if sub}
    <div class="mt-1 text-xs text-dim tnum">{@html sub}</div>
  {/if}
</div>

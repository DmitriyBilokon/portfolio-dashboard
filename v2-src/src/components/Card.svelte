<script lang="ts">
  export let title: string = '';
  export let subtitle: string = '';
  let cls = '';
  export { cls as class };
</script>

<section class="card p-4 sm:p-5 {cls}">
  {#if title || subtitle || $$slots.head}
    <header class="mb-3 flex items-center justify-between gap-3">
      <div class="min-w-0">
        {#if title}<h3 class="truncate text-sm font-semibold text-txt">{title}</h3>{/if}
        {#if subtitle}<p class="truncate text-xs text-dim">{subtitle}</p>{/if}
      </div>
      <slot name="head" />
    </header>
  {/if}
  <slot />
</section>

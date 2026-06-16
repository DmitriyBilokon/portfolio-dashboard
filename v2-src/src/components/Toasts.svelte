<script lang="ts">
  import { toasts } from '../lib/toast';
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
  {#each $toasts as t (t.id)}
    <div
      class="pointer-events-auto max-w-md rounded-lg border px-4 py-2 text-sm shadow-lg"
      class:border-down={t.err}
      class:border-border={!t.err}
      style="background: var(--surface2)"
    >
      {t.msg}
    </div>
  {/each}
</div>

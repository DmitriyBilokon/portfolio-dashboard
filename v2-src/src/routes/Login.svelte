<script lang="ts">
  import { t, rt } from '../lib/i18n';
  import { signIn } from '../lib/data';

  let email = '';
  let password = '';
  let err = '';
  let busy = false;

  async function submit() {
    err = '';
    busy = true;
    err = (await signIn(email.trim(), password)) ?? '';
    busy = false;
  }
</script>

<div class="grid min-h-[70vh] place-items-center px-4">
  <div class="card w-full max-w-sm p-6">
    <div class="mb-1 flex items-center gap-2">
      <span class="grid h-8 w-8 place-items-center rounded-lg text-accent" style="background: color-mix(in srgb, var(--accent) 16%, transparent)">◆</span>
      <h1 class="text-lg font-semibold">Портфель <span class="text-accent">v2</span></h1>
    </div>
    <p class="mb-5 text-sm text-dim">{$t('connectAccount')}</p>
    <form class="space-y-3" on:submit|preventDefault={submit}>
      <div>
        <label class="label" for="em">{$t('email')}</label>
        <input
          id="em"
          class="mt-1 w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
          type="email"
          autocomplete="email"
          bind:value={email}
          required
        />
      </div>
      <div>
        <label class="label" for="pw">{$t('password')}</label>
        <input
          id="pw"
          class="mt-1 w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm"
          type="password"
          autocomplete="current-password"
          bind:value={password}
          required
        />
      </div>
      {#if err}<p class="text-sm text-down">{err}</p>{/if}
      <button class="btn w-full justify-center" type="submit" disabled={busy}>
        {busy ? $t('loading') : $t('signIn')}
      </button>
    </form>
    <p class="mt-4 text-center text-xs text-faint">
      {$rt('Тот же аккаунт, что и на основном сайте', 'Same account as the main site')}
    </p>
  </div>
</div>

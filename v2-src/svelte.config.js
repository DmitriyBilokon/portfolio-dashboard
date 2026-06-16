import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  // vitePreprocess включает поддержку TypeScript в <script lang="ts"> и PostCSS/Tailwind.
  preprocess: vitePreprocess(),
};

import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Сборка кладёт статику в ../v2 (рядом с текущим сайтом, тот не трогаем).
// base: './' — относительные пути, чтобы работало и на project-page
// (dmitriybilokon.github.io/portfolio-dashboard/v2/), и на кастомном домене.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: {
    outDir: '../v2',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
  },
});

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,ts,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Семантические цвета берутся из CSS-переменных (см. app.css) — одна точка
      // правды для тёмной/светлой темы. В разметке: bg-surface, text-dim, text-up…
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface2)',
        border: 'var(--border)',
        txt: 'var(--txt)',
        dim: 'var(--dim)',
        faint: 'var(--faint)',
        up: 'var(--up)',
        down: 'var(--down)',
        accent: 'var(--accent)',
      },
      borderRadius: { xl2: '1.1rem' },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

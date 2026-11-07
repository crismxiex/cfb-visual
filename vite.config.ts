import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { rollupOptions: { input: { dashboard: 'dashboard.html', background: 'src/background.ts' }, output: { entryFileNames: chunk => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js' } } },
});

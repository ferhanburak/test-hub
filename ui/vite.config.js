import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works on GitHub Pages (/test-hub/) and locally.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5180 },
  preview: { port: 5181 },
});

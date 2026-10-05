import { resolve } from 'node:path';

import { defineConfig } from 'vite';

// Two pages: the landing at / and the terminal at /app/. In development the browser talks to
// Vite only; the API and the market stream are proxied to the Spring Boot backend.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});

import { resolve } from 'node:path';

import { defineConfig } from 'vite';

import { seoPages } from './seo';
import { RU } from './src/locale-ru';

// Three pages: the landing at /, the terminal at /app/ and the signal record at /record/. In development the browser talks to
// Vite only; the API and the market stream are proxied to the Spring Boot backend.
// PULSE_BACKEND points the dev server at another backend, e.g. the Docker stack on :8088,
// so the frontend can be worked on without starting a second copy of the Java app.
const backend = process.env.PULSE_BACKEND ?? 'http://localhost:8080';
// the backend checks the Origin of WebSocket handshakes; through the proxy it must see its own
const headers = process.env.PULSE_BACKEND ? { origin: backend } : undefined;

export default defineConfig({
  // Russian twins at /ru/ with the text in the HTML, canonical and hreflang (seo.ts)
  plugins: [seoPages(RU, process.env.VITE_STANDALONE === '1')],
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
        record: resolve(import.meta.dirname, 'record/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: backend, headers },
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true, headers },
    },
  },
});

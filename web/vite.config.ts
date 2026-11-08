import { resolve } from 'node:path';

import { defineConfig } from 'vite';

// Four pages: the landing at /, the terminal at /app/, the signal record at /record/ and the game at /play/. In development the browser talks to
// Vite only; the API and the market stream are proxied to the Spring Boot backend.
// PULSE_BACKEND points the dev server at another backend, e.g. the Docker stack on :8088,
// so the frontend can be worked on without starting a second copy of the Java app.
const backend = process.env.PULSE_BACKEND ?? 'http://localhost:8080';
// the backend checks the Origin of WebSocket handshakes; through the proxy it must see its own
const headers = process.env.PULSE_BACKEND ? { origin: backend } : undefined;

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
        record: resolve(import.meta.dirname, 'record/index.html'),
        play: resolve(import.meta.dirname, 'play/index.html'),
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

import { defineConfig } from 'vite';

// In development the browser talks to Vite only; API and the market stream are proxied to the
// Spring Boot backend, so there is no CORS to configure.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});

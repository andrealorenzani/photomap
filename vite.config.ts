/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Native dev path only (php -S + `npm run dev`): proxies /api to the backend so the browser
// sees everything as same-origin, exactly like the Docker nginx proxy does for the whole-stack
// path — neither ever needs CORS/SameSite=None. VITE_DEV_API_PROXY_TARGET overrides the default
// backend URL if it's running somewhere other than localhost:8000.
const devApiProxyTarget = process.env.VITE_DEV_API_PROXY_TARGET || 'http://localhost:8000';

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  server: {
    proxy: {
      '/api': {
        target: devApiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    exclude: ['node_modules', 'dist'],
  },
});

import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // DEV_PROXY_TARGET (not exposed to the client): forward /api and /ws to the backend so the
  // browser stays same-origin and backend CORS settings don't matter (used by the :3001 dispatcher).
  const proxyTarget = loadEnv(mode, process.cwd(), '').DEV_PROXY_TARGET;
  const proxy = proxyTarget
    ? {
        '/api': { target: proxyTarget, changeOrigin: true },
        '/ws': { target: proxyTarget.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
      }
    : undefined;

  return {
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: { port: 5173, proxy },
    preview: { proxy },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        // Registered manually in main.tsx (skipped in mock mode: MSW needs the same scope).
        injectRegister: null,
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Bakı Təxliyə',
          short_name: 'Təxliyə',
          description: 'Bakı üçün fövqəladə təxliyə və SOS tətbiqi',
          lang: 'az',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#0f172a',
          theme_color: '#DC2626',
          icons: [
            { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml' },
            { src: 'pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          globIgnores: ['mockServiceWorker.js'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              // Last known assembly points / zones are served from cache when offline.
              urlPattern: ({ url }) => /\/api\/v1\/(assembly-points|zones)/.test(url.pathname),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-points',
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
            {
              urlPattern: ({ url }) => /(openfreemap\.org|cartocdn\.com)$/.test(url.hostname),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'map-tiles',
                expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 7 },
              },
            },
          ],
        },
      }),
    ],
    build: {
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          manualChunks: {
            map: ['maplibre-gl', 'react-map-gl'],
            charts: ['recharts'],
            react: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
  };
});

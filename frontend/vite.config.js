import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  // Only needed if deploying into a subfolder (e.g. yourdomain.com/pos/)
  // instead of a domain/subdomain root — set VITE_BASE_PATH=/pos/ at
  // build time in that case. The recommended Hostinger setup (a
  // subdomain, see docs/DEPLOYMENT_HOSTINGER.md) never needs this.
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' + clientsClaim/skipWaiting below is what satisfies
      // "updates instantly for every branch ... no manual install or
      // update process on any machine": the moment a new build is
      // deployed, the next tab a branch opens (or the next periodic
      // check, registered in main.jsx) swaps in the new service worker
      // and reloads, with zero action from staff or IT.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Bakery POS',
        short_name: 'Bakery POS',
        description: 'Multi-branch bakery point of sale',
        theme_color: '#1c1917',
        background_color: '#faf9f7',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Precache the app shell (HTML/JS/CSS) so the app OPENS even
        // with no connection at all. Actual bakery data (items,
        // pending bills) is handled separately by Dexie/IndexedDB in
        // src/lib/localDb.js — deliberately NOT through workbox
        // request caching, because billing writes need our own
        // conflict-free sync logic (see src/lib/syncEngine.js), not a
        // generic HTTP cache.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Never let a stale cached copy of index.html get served once
        // a new deploy exists — always check the network first for
        // navigation requests, falling back to cache only if offline.
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'app-shell', networkTimeoutSeconds: 3 },
          },
        ],
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173 },
});

import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Vite configuration for the Ligue Keeper frontend.
// react()      : compiles the React + TypeScript code.
// tailwindcss(): turns the utility classes used in the code into real CSS.
// VitePWA()    : generates the service worker + web manifest, and keeps
//                every open client tab in sync automatically.
export default defineConfig(({ mode }) => ({
    plugins: [
        react(),
        tailwindcss(),

        VitePWA({
            // 'autoUpdate' tells the plugin to force
            // workbox.clientsClaim = true and workbox.skipWaiting = true,
            // so a new service worker activates the moment it is
            // installed and takes over every open tab immediately.
            registerType: 'autoUpdate',

            // Files that should be copied to the build output as-is.
            // The favicon is already referenced by index.html.
            includeAssets: ['favicon.svg'],

            // Web app manifest: what the installed icon looks like,
            // what name shows under it, and how the window opens.
            manifest: {
                name: 'Ligue de Mousse',
                short_name: 'Ligue',
                description:
                    "Application de la ligue de hockey fantasy Ligue de Mousse.",
                lang: 'fr',
                theme_color: '#080D1A',
                background_color: '#080D1A',
                display: 'standalone',
                orientation: 'portrait',
                start_url: '/',
                scope: '/',
                icons: [
                    {
                        src: '/images/league/icon-192.png',
                        sizes: '192x192',
                        type: 'image/png',
                    },
                    {
                        src: '/images/league/icon-512.png',
                        sizes: '512x512',
                        type: 'image/png',
                    },
                    {
                        src: '/images/league/icon-512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                ],
            },

            workbox: {
                // Precache everything the SPA needs to render offline:
                // the compiled JS/CSS/HTML plus the fonts and images
                // that are served from our own origin.
                globPatterns: [
                    '**/*.{js,css,html,svg,png,ico,woff2}',
                ],

                // The backend is reached through /api/*, which nginx
                // proxies to the ASP.NET container. We do NOT want the
                // service worker to cache API responses: standings,
                // live game data and roster data must always be fresh.
                // Only same-origin static assets are precached.
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api\//],

                // Removes caches from previous app versions on
                // activation. On by default with generateSW; kept
                // explicit so it is visible.
                cleanupOutdatedCaches: true,

                // The NHL CDN logos are immutable per team, so they can
                // be cached aggressively after the first fetch. This is
                // a runtime cache, not a precache, so it only grows
                // when the app actually requests a logo.
                runtimeCaching: [
                    {
                        urlPattern:
                            /^https:\/\/assets\.nhle\.com\/logos\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'nhl-logos',
                            expiration: {
                                maxEntries: 64,
                                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                            },
                        },
                    },
                    {
                        urlPattern:
                            /^https:\/\/flagcdn\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'flags',
                            expiration: {
                                maxEntries: 64,
                                maxAgeSeconds: 30 * 24 * 60 * 60,
                            },
                        },
                    },
                ],
            },

            // The service worker is only useful on a production build.
            // Leaving it off in dev avoids the "old cached page" trap
            // while you are iterating.
            devOptions: {
                enabled: false,
            },
        }),
    ],
    resolve: {
        alias: [
            // The @/ alias used by every src file. Regex with prefix match.
            {
                find: /^@\//,
                replacement: path.resolve(__dirname, 'src') + '/',
            },

            // React Router v7 production-build workaround.
            ...(mode === 'production'
                ? [
                    {
                        find: /^react-router\/dom$/,
                        replacement: path.resolve(
                            __dirname,
                            'node_modules/react-router/dist/production/dom-export.mjs',
                        ),
                    },
                    {
                        find: /^react-router$/,
                        replacement: path.resolve(
                            __dirname,
                            'node_modules/react-router/dist/production/index.mjs',
                        ),
                    },
                ]
                : []),
        ],
        conditions: ['production', 'import', 'module', 'browser', 'default'],
    },
    server: {
        host: '0.0.0.0',
        proxy: {
            '/api': {
                target: 'https://localhost:7081',
                changeOrigin: true,
                secure: false,
            },
        },
    },
}));
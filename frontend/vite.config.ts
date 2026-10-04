import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Vite configuration for the Ligue Keeper frontend.
// react()      : compiles the React + TypeScript code.
// tailwindcss(): turns the utility classes used in the code into real CSS.
export default defineConfig(({ mode }) => ({
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: [
            // The @/ alias used by every src file. Regex with prefix match.
            {
                find: /^@\//,
                replacement: path.resolve(__dirname, 'src') + '/',
            },

            // React Router v7 ships its production build (dist/production/)
            // but its package.json does NOT expose a `production` export
            // condition, so Vite always picks the development build (which
            // is what the "default" condition points at). There is no
            // conditions-based fix. Instead we point Vite straight at the
            // production files. Exact-match regexes are required, because
            // a prefix match on `react-router` would also capture
            // `react-router/dom` and break the subpath resolution.
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
            // Every browser call to /api/... is forwarded to the ASP.NET backend.
            '/api': {
                target: 'https://localhost:7081',
                changeOrigin: true,
                secure: false,
            },
        },
    },
}));
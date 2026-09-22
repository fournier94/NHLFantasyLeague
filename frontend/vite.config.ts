import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Vite configuration for the Ligue Keeper frontend.
// react()      : compiles the React + TypeScript code.
// tailwindcss(): turns the utility classes used in the code into real CSS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // '@' is a shortcut for the 'src' folder, e.g. '@/pages/LiguePage'.
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Every browser call to /api/... is forwarded to the ASP.NET backend.
      '/api': {
        target: 'https://localhost:7081', // https dev port from Properties\launchSettings.json
        changeOrigin: true,
        secure: false, // the ASP.NET dev certificate is not trusted by Node
      },
    },
  },
});

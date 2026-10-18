import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Libraries go in their own files: they rarely change, so browsers keep
// them between deploys and only download the app code that changed.
// Heavy, rarely used libraries (charts, PDF) stay with the pages that load them.
const VENDOR: [RegExp, string][] = [
  [/[\/]node_modules[\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\/]/, 'react'],
  [/[\/]node_modules[\/]@supabase[\/]/, 'supabase'],
  [/[\/]node_modules[\/]@tanstack[\/]/, 'tanstack'],
  [/[\/]node_modules[\/]lucide-react[\/]/, 'icons'],
  [/[\/]node_modules[\/](cmdk|@floating-ui|@radix-ui)[\/]/, 'ui'],
];

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          for (const [re, name] of VENDOR) if (re.test(id)) return name;
          return undefined;
        },
      },
    },
  },
});

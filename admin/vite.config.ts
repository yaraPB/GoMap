import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The Mapbox public token: admin/.env.local (VITE_MAPBOX_TOKEN), or reuse the mobile app's.
export default defineConfig(({ mode }) => {
  const own = loadEnv(mode, process.cwd(), 'VITE_');
  const mobile = loadEnv(mode, '../mobile', 'EXPO_PUBLIC_');
  return {
    plugins: [react()],
    define: {
      __MAPBOX_TOKEN__: JSON.stringify(own.VITE_MAPBOX_TOKEN || mobile.EXPO_PUBLIC_MAPBOX_TOKEN || ''),
      __API_URL__: JSON.stringify(own.VITE_API_URL || 'http://localhost:4000'),
    },
    server: { port: 5173 },
  };
});

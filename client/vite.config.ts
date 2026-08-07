import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Env lives at the repo root so client and server read one file.
  const env = loadEnv(mode, '..', '');
  const apiPort = env['PORT'] ?? '4000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Same-origin in the browser during development, which keeps cookies
      // working exactly as they do in production.
      proxy: {
        '/api': {
          target: `http://localhost:${apiPort}`,
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      // The tree and timeline screens are heavy and rarely the entry point, so
      // let Rollup split them out rather than shipping one large chunk.
      chunkSizeWarningLimit: 700,
    },
  };
});

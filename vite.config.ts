import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * MapLibre's worker is shipped as a plain asset (imported with `?url`). Two things about it are
 * tidied for hosting:
 *  - it is published as `.js`, because some static hosts serve `.mjs` with a type browsers refuse
 *    to run as a script, which would leave the maps blank;
 *  - its trailing source-map comment is dropped, since the map itself is not published.
 */
function mapWorkerAsset(): Plugin {
  return {
    name: 'wwiwiwh:map-worker-asset',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !/maplibre-gl-worker.*\.js$/.test(file.fileName)) continue;
        const source = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
        file.source = source.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, '\n');
      }
    },
  };
}

export default defineConfig({
  base: './',
  // Lets several dev servers run side by side without sharing a dependency cache.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  plugins: [mapWorkerAsset()],
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  preview: { host: '127.0.0.1', port: 4173, strictPort: false },
  build: {
    target: 'es2022',
    sourcemap: true,
    // MapLibre alone is about 1.1 MB (300 kB gzipped); the app has nothing worth splitting off.
    chunkSizeWarningLimit: 1400,
    rolldownOptions: {
      output: {
        assetFileNames: (asset) =>
          asset.names.some((name) => name.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // CSS is read as text by the test that holds it to the inks in src/app/theme.ts; nothing else imports any.
    css: true,
  },
});

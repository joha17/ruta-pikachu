import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

// Lector de texto (Tesseract.js) servido desde la propia app, sin CDN: el worker, el motor
// WebAssembly y los datos de inglés se copian de node_modules al build (no van al repo).
const req = createRequire(import.meta.url);
const dirOf = (pkg: string) => dirname(req.resolve(`${pkg}/package.json`));
const OCR_FILES: Record<string, string> = {
  'ocr/worker.min.js': join(dirOf('tesseract.js'), 'dist/worker.min.js'),
  'ocr/lang/eng.traineddata.gz': join(dirOf('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'),
};
for (const v of ['lstm', 'simd-lstm', 'relaxedsimd-lstm'])
  OCR_FILES[`ocr/core/tesseract-core-${v}.wasm.js`] = join(dirOf('tesseract.js-core'), `tesseract-core-${v}.wasm.js`);

function ocrAssets(): Plugin {
  return {
    name: 'ruta-ocr-assets',
    configureServer(server) {
      server.middlewares.use((rq, rs, next) => {
        const path = (rq.url ?? '').split('?')[0]!.replace(base, '');
        const file = OCR_FILES[path];
        if (!file) return next();
        rs.setHeader('Content-Type', path.endsWith('.gz') ? 'application/gzip' : 'text/javascript');
        rs.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(OCR_FILES)) this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
    },
  };
}

// En GitHub Pages la app vive en /<repo>/. El workflow pasa BASE=/<repo>/.
const base = process.env.BASE ?? '/';

export default defineConfig({
  base,
  plugins: [
    preact(),
    ocrAssets(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Ruta Pikachu · mi colección',
        short_name: 'Ruta Pikachu',
        description: 'Mi colección de cartas Pokémon: hojas, binder, precios y escáner.',
        lang: 'es',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#111318',
        theme_color: '#1F2128',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Solo la app (HTML, JS, CSS, fuentes, íconos). Nunca imágenes de cartas de TCGdex:
        // esas se enlazan directo desde assets.tcgdex.net y no pasan por la caché.
        globPatterns: ['**/*.{html,js,css,woff2,svg,png,webmanifest}'],
        // El lector (ocr/) y el SDK de Claude (sdk-*.js) se bajan solo al usarlos; Claude sin internet no sirve.
        globIgnores: ['**/node_modules/**', 'ocr/**', 'assets/sdk-*.js'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/ocr\//],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'lector-ocr', expiration: { maxEntries: 10 } },
          },
          {
            // El GIF de la cabecera (public/sprites) no se precarga al instalar: se guarda la primera vez que se ven.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/sprites/'),
            handler: 'CacheFirst',
            options: { cacheName: 'sprites', expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
});

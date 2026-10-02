import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { captureInk } from './scripts/dev/captureInk.ts';

export default defineConfig(({ command, mode, isPreview }) => {
  // "Report a misread" is a development aid for collecting handwriting from a tablet.
  // Its receiving route exists on the dev server and in `--mode capture`, nowhere else.
  const captureMode = mode === 'capture';
  const capturing = captureMode || (command === 'serve' && !isPreview);

  return {
    // Relative base so the same build works at a domain root (Vercel) and under a
    // sub-path (GitHub Pages) without rebuilding.
    base: './',
    build: {
      target: 'es2022',
    },
    worker: {
      format: 'es',
    },
    plugins: [
      ...(capturing ? [captureInk()] : []),
      VitePWA({
        // A capture build is served from the development machine for an afternoon. A
        // service worker would only keep stale copies of it on the tablet.
        disable: captureMode,
        // A new deployment takes over on the next visit without asking.
        registerType: 'autoUpdate',
        workbox: {
          // Precache everything the app can ever request, so that after the first visit
          // it runs with no network at all: code, styles, font, model and WASM runtime.
          globPatterns: ['**/*.{html,js,css,svg,png,woff,woff2,wasm,onnx,txt}'],
          // The ONNX runtime is a single 14 MB file; the default limit is 2 MB.
          maximumFileSizeToCacheInBytes: 24 * 1024 * 1024,
          // Take control of the page that installed the worker, so the very first visit
          // is already served from the cache if the connection drops.
          clientsClaim: true,
          skipWaiting: true,
          cleanupOutdatedCaches: true,
        },
        manifest: {
          name: 'CalcInk',
          short_name: 'CalcInk',
          description: 'Write arithmetic by hand and get the answer inline. Runs on your device.',
          display: 'standalone',
          orientation: 'any',
          start_url: './',
          scope: './',
          theme_color: '#fafbf7',
          background_color: '#fafbf7',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
  };
});

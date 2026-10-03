import '@fontsource/kalam/latin-300.css';
import { registerSW } from 'virtual:pwa-register';
import './styles/base.css';
import './styles/notebook.css';
import { App } from './app/App';

declare global {
  interface Window {
    /** The running app, for the browser console and for automated browser tests. */
    calcink?: App;
  }
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root element');

const app = new App(root);
window.calcink = app;

// The service worker downloads every file the app needs, model and WASM runtime
// included, and serves them from the cache from then on. Once it reports ready, the app
// no longer needs a network connection at all.
registerSW({
  immediate: true,
  onOfflineReady: () => app.showNotice('Saved to this device. CalcInk now works offline.', 6000),
});

// "Report a misread" is a development aid for collecting real handwriting. Both
// conditions are constants at build time, so in the production build this whole branch,
// and the module it would load, are removed.
let removeCapture = (): void => {};
if (import.meta.env.DEV || import.meta.env.MODE === 'capture') {
  void import('./dev/capture').then(({ installCapture }) => {
    removeCapture = installCapture(app);
  });
}

// During development Vite swaps this module in place. Tearing the old instance down
// first is also a standing check that destroy() really does release everything.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    removeCapture();
    app.destroy();
  });
}

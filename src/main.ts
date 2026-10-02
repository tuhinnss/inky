import '@fontsource/kalam/latin-300.css';
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

// During development Vite swaps this module in place. Tearing the old instance down
// first is also a standing check that destroy() really does release everything.
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.destroy());
}

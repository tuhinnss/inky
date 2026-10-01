import '@fontsource/kalam/latin-400.css';
import './styles/base.css';
import './styles/notebook.css';
import { App } from './app/App';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root element');

const app = new App(root);

// During development Vite swaps this module in place. Tearing the old instance down
// first is also a standing check that destroy() really does release everything.
if (import.meta.hot) {
  import.meta.hot.dispose(() => app.destroy());
}

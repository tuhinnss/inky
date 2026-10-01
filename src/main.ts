import './styles/base.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root element');

root.textContent = 'CalcInk';

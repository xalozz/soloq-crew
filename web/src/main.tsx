// Punto de entrada: los estilos de siempre (style.css de la raíz, tal cual) y la app
import { createRoot } from 'react-dom/client';
import '../../style.css';
import './root.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);

// App instalable y con los últimos datos sin conexión (sw.js solo existe en la versión compilada)
if (import.meta.env.PROD && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

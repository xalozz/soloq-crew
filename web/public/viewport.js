// "Vista de ordenador" (menú Más): también funciona con la app instalada, donde Chrome no muestra su menú.
// Va en un fichero aparte (no en línea, por la CSP) y se carga antes de pintar nada.
try { if (localStorage.getItem('sq-desktop') === '1') document.querySelector('meta[name=viewport]').setAttribute('content', 'width=1280, initial-scale=' + Math.min(1, screen.width / 1280).toFixed(3)); } catch (e) {}

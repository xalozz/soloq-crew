/* Menú de la cabecera (panel · tu cuenta · administración · salir). Copiado de luz y estado (aquí el primer enlace es el ranking). */
(() => {
  'use strict';
  const nav = document.getElementById('menu');
  if (!nav) return;
  const aqui = location.pathname;
  const enlace = (href, texto) => `<a href="${href}" class="${aqui === href ? 'on' : ''}">${texto}</a>`;
  fetch('/api/me', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (!me) return;
      nav.innerHTML = [enlace('/', 'ranking'), enlace('/ajustes', 'cuenta'), me.is_admin ? enlace('/admin', 'admin') : ''].join('');
      nav.title = `Has entrado como ${me.username}`;
    })
    .catch(() => {});
  document.addEventListener('click', async (ev) => {
    if (!ev.target.closest('[data-salir]')) return;
    await fetch('/api/salir', { method: 'POST', headers: { 'X-Panel': '1' } }).catch(() => {});
    location.href = '/entrar';
  });
})();

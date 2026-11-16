// Entrar: usuario y contraseña; si la cuenta tiene la verificación en dos pasos, el servidor responde {codigo: true}
// y se pide el código. Copiado de luz y estado (aquí, tras entrar se va a /admin).
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const form = $('form');
  const error = $('error');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.textContent = '';
    const boton = form.querySelector('button');
    boton.disabled = true;
    try {
      const r = await fetch('/api/entrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Panel': '1' },
        body: JSON.stringify({ usuario: $('usuario').value.trim().toLowerCase(), clave: $('clave').value, codigo: $('codigo').value }),
      });
      const datos = await r.json().catch(() => ({}));
      if (r.ok && datos.codigo) {
        $('campo-codigo').hidden = false;
        $('codigo').required = true;
        $('codigo').focus();
        error.textContent = '';
      } else if (r.ok) {
        location.href = '/admin';
        return;
      } else {
        error.textContent = datos.detail || 'No se ha podido entrar.';
        $('codigo').value = '';
      }
    } catch { error.textContent = 'Sin conexión.'; }
    boton.disabled = false;
  });
})();

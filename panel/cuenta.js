/* Alta con enlace de invitación y restablecer el acceso (contraseña nueva). El token va en el
   fragmento (#t=…), que el navegador no manda al servidor ni a terceros. Copiado de luz y estado. */
(() => {
  'use strict';
  const $ = (s) => document.getElementById(s);
  const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
  let info = null;

  async function api(path, body) {
    const r = await fetch(path, body === undefined ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `Error ${r.status}`);
    return data;
  }
  function malo(text) {
    $('cargando').hidden = true;
    $('form').hidden = true;
    $('malo-txt').textContent = text;
    $('malo').hidden = false;
  }

  async function init() {
    if (!token) { malo('Falta el código del enlace. Ábrelo tal y como te llegó, sin recortarlo.'); return; }
    try { info = await api(`/api/invite/${encodeURIComponent(token)}`); } catch (err) { malo(err.message); return; }
    $('cargando').hidden = true;
    $('form').hidden = false;
    if (info.kind === 'alta') {
      $('titulo').textContent = 'Crea tu cuenta';
      $('intro').textContent = 'Elige un usuario y una contraseña. El enlace solo sirve una vez. Si quieres, luego puedes activar la verificación en dos pasos en «cuenta».';
      $('enviar').textContent = 'Crear cuenta';
      $('usuario').focus();
    } else {
      $('titulo').textContent = 'Restablecer el acceso';
      $('intro').textContent = `Para la cuenta «${info.username}». Pon una contraseña nueva. Si tenías la verificación en dos pasos, queda desactivada (el código anterior deja de valer) y puedes volver a activarla en «cuenta». Se cerrará la sesión en tus otros dispositivos.`;
      $('campo-usuario').hidden = true;
      $('usuario-oculto').value = info.username;
      $('enviar').textContent = 'Guardar y entrar';
      $('clave').focus();
    }
  }

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('error').textContent = '';
    if ($('clave').value !== $('clave2').value) { $('error').textContent = 'Las dos contraseñas no coinciden.'; $('clave2').focus(); return; }
    $('enviar').disabled = true;
    try {
      const out = await api(`/api/invite/${encodeURIComponent(token)}`, {
        username: $('usuario').value.trim().toLowerCase(), password: $('clave').value,
      });
      history.replaceState(null, '', '/cuenta');
      location.href = '/ajustes';
    } catch (err) {
      $('error').textContent = err.message;
      $('enviar').disabled = false;
    }
  });

  init();
})();

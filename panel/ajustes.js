/* Tu cuenta: contraseña, verificación en dos pasos (opcional) y sesiones. Copiado de luz y estado. */
(() => {
  'use strict';
  const $ = (s) => document.getElementById(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fecha = (iso) => { if (!iso) return '—'; const d = new Date(iso); return `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const hace = (iso) => {
    if (!iso) return 'nunca';
    const m = (Date.now() - new Date(iso).getTime()) / 60000;
    return m < 2 ? 'hace un momento' : m < 60 ? `hace ${Math.round(m)} min` : m < 2160 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
  };
  const aparato = (a) => {
    if (!a) return '—';
    const os = /Android/.test(a) ? 'Android' : /iPhone|iPad/.test(a) ? 'iOS' : /Windows/.test(a) ? 'Windows' : /Mac OS X/.test(a) ? 'macOS' : /Linux/.test(a) ? 'Linux' : '';
    const br = /Edg\//.test(a) ? 'Edge' : /OPR\//.test(a) ? 'Opera' : /Firefox\//.test(a) ? 'Firefox' : /Chrome\//.test(a) ? 'Chrome' : /Safari\//.test(a) ? 'Safari' : '';
    return [br, os].filter(Boolean).join(' · ') || a.slice(0, 30);
  };
  async function api(path, body) {
    const r = await fetch(path, body === undefined ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Panel': '1' }, body: JSON.stringify(body) });
    if (r.status === 401) { location.href = '/entrar'; throw new Error('Sesión caducada.'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || `Error ${r.status}`);
    return data;
  }
  function decir(texto, tono = '') { $('pw-msg').textContent = texto; $('pw-msg').className = `a-msg ${tono}`; }

  async function cargar() {
    const me = await api('/api/me');
    $('quien').textContent = `Has entrado como «${me.username}»${me.is_admin ? ' (administrador)' : ''}. Cuenta creada el ${fecha(me.created_at)}.`;
    $('pw-user').value = me.username;
    $('dos-user').value = me.username;
    if (dos.activa !== me.totp || $('dos-form').hidden) { dos.activa = me.totp; pintarDos(); }
    $('sesiones').innerHTML = me.sessions.map((s) => `<tr><td>${esc(aparato(s.agent))}${s.current ? ' <span class="a-tag">esta</span>' : ''}</td>
      <td class="a-mono">${esc(s.ip || '—')}</td><td>${esc(fecha(s.created_at))}</td><td>${esc(hace(s.last_seen || s.created_at))}</td></tr>`).join('')
      || '<tr><td colspan="4" class="a-empty">Ninguna.</td></tr>';
  }

  $('pw').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if ($('pw-nueva').value !== $('pw-nueva2').value) { decir('Las dos contraseñas nuevas no coinciden.', 'err'); return; }
    try {
      await api('/api/clave', { actual: $('pw-actual').value, nueva: $('pw-nueva').value });
      ev.target.reset();
      decir('Contraseña cambiada. Las demás sesiones se han cerrado.');
      await cargar();
    } catch (err) { decir(err.message, 'err'); }
  });
  // ---- verificación en dos pasos (opcional)
  let dos = { activa: false, secreto: null };
  function pintarDos() {
    $('dos-estado').innerHTML = dos.activa ? '<span class="a-dot ok"></span>Activada' : '<span class="a-dot"></span>Desactivada';
    $('dos-intro').textContent = dos.activa
      ? 'Al entrar en un dispositivo nuevo te pedimos, además de la contraseña, un código de la app de tu móvil. Luego no vuelve a pedírtelo en ese dispositivo mientras lo uses al menos una vez al mes.'
      : 'Opcional. Si la activas, al entrar en un dispositivo nuevo te pediremos, además de la contraseña, un código de 6 cifras de una app de tu móvil. Así, aunque alguien sepa tu contraseña, no puede entrar sin tu móvil.';
    $('dos-empezar').textContent = dos.activa ? 'Desactivar…' : 'Activar…';
    $('dos-ok').textContent = dos.activa ? 'Desactivar' : 'Activar';
    $('dos-acciones').hidden = false;
    $('dos-form').hidden = true;
    $('dos-alta').hidden = true;
  }
  $('dos-empezar').addEventListener('click', async () => {
    $('dos-msg').textContent = '';
    if (!dos.activa) {
      try {
        const n = await api('/api/2fa/nuevo');
        dos.secreto = n.totp_secret;
        $('dos-qr').src = n.totp_qr;
        $('dos-secreto').textContent = n.totp_secret.replace(/(.{4})/g, '$1 ').trim();
        $('dos-alta').hidden = false;
      } catch (err) { $('dos-msg').textContent = err.message; $('dos-msg').className = 'a-msg err'; return; }
    }
    $('dos-acciones').hidden = true;
    $('dos-form').hidden = false;
    $('dos-clave').focus();
  });
  $('dos-cancelar').addEventListener('click', () => { $('dos-form').reset(); pintarDos(); });
  $('dos-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const out = await api('/api/2fa', { activar: !dos.activa, clave: $('dos-clave').value, codigo: $('dos-codigo').value, totp_secret: dos.secreto });
      dos.activa = out.totp;
      ev.target.reset();
      pintarDos();
      $('dos-msg').textContent = dos.activa ? 'Verificación en dos pasos activada. Las demás sesiones se han cerrado.' : 'Verificación en dos pasos desactivada. Las demás sesiones se han cerrado.';
      $('dos-msg').className = 'a-msg';
      await cargar();
    } catch (err) { $('dos-msg').textContent = err.message; $('dos-msg').className = 'a-msg err'; }
  });

  $('todas').addEventListener('click', async () => {
    try { await api('/api/salir-todo', {}); } catch { /* da igual */ }
    location.href = '/entrar';
  });
  cargar().catch((err) => decir(`No se ha podido cargar: ${err.message}`, 'err'));
})();

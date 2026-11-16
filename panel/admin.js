/* Administración: el mismo archivo en Bitácora, luz y estado (la Agenda tiene la versión en React).
   Secciones como las de Gitea, Authentik o Grafana: Resumen · Usuarios (con ficha) · Invitaciones · Sesiones ·
   Registro. Lo propio de cada app (columnas, datos de la ficha, acciones, textos) llega en window.ADMIN, que
   define admin-app.js (también secciones propias: window.ADMIN.sections). Rutas en el fragmento: #usuarios, #usuarios/3, #registro?cat=acceso&user=3… */
(() => {
  'use strict';
  const APP = Object.assign({
    name: '',
    twoFactor: false,                 // luz y estado: cada cuenta tiene su código TOTP
    appCat: 'App',                    // nombre de la categoría propia en el registro
    kpis: () => [],                   // [[título, valor, pie, tono?]]
    columns: [],                      // [{title, cell(u) → html}]
    facts: () => [],                  // [[título, html]] en la ficha
    actions: () => [],                // [{label, run(u, ctx), hidden?}] en la ficha
    resetLabel: 'Enlace para nueva contraseña',
    resetIntro: (u) => `Con este enlace «${u.username}» pone una contraseña nueva sin saber la anterior.`,
    inviteIntro: 'Con este enlace la persona elige su usuario y su contraseña.',
    deleteText: (u) => `Se borran su cuenta y todo lo suyo. No se puede deshacer.`,
    poll: () => false,                // si hay que refrescar solo (p. ej. sincronizando)
    sections: [],                     // secciones propias de la app tras Resumen: [{key, label, render(main, ctx, ruta)}]
    afterRender: null,
  }, window.ADMIN || {});

  // ------------------------------------------------------------------ utilidades
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (method !== 'GET') headers['X-Panel'] = '1';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch (err) { throw new Error('No hay conexión con el servidor.'); }
    if (res.status === 401) { location.href = '/entrar'; throw new Error('Sesión caducada.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Error ${res.status}`);
    return data;
  }

  const toDate = (v) => (typeof v === 'number' ? new Date(v) : new Date(String(v).length <= 10 ? `${v}T00:00:00` : v));
  function date(v, withTime = false) {
    if (v === null || v === undefined || v === '') return '—';
    const d = toDate(v);
    if (Number.isNaN(d.getTime())) return '—';
    const base = `${d.getDate()} ${MES[d.getMonth()]} ${d.getFullYear()}`;
    return withTime ? `${base}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : base;
  }
  function ago(v) {
    if (v === null || v === undefined || v === '') return 'nunca';
    const mins = (Date.now() - toDate(v).getTime()) / 60000;
    if (Number.isNaN(mins)) return '—';
    if (mins < 0) { const m = -mins; return m < 60 * 36 ? `dentro de ${Math.round(m / 60)} h` : `dentro de ${Math.round(m / 1440)} días`; }
    if (mins < 2) return 'hace un momento';
    if (mins < 60) return `hace ${Math.round(mins)} min`;
    if (mins < 60 * 36) return `hace ${Math.round(mins / 60)} h`;
    return `hace ${Math.round(mins / 1440)} días`;
  }
  function bytes(n) {
    if (!Number.isFinite(n)) return '—';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toLocaleString('es-ES', { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
  }
  // «Mozilla/5.0 (Windows NT 10.0…) … Chrome/…» → «Chrome · Windows»
  function device(agent) {
    if (!agent) return '—';
    const a = String(agent);
    const os = /Android/.test(a) ? 'Android' : /iPhone|iPad/.test(a) ? 'iOS' : /Windows/.test(a) ? 'Windows'
      : /Mac OS X/.test(a) ? 'macOS' : /CrOS/.test(a) ? 'ChromeOS' : /Linux/.test(a) ? 'Linux' : '';
    const br = /Edg\//.test(a) ? 'Edge' : /OPR\//.test(a) ? 'Opera' : /Firefox\//.test(a) ? 'Firefox'
      : /Chrome\//.test(a) ? 'Chrome' : /Safari\//.test(a) ? 'Safari' : /okhttp|Dalvik|Ktor/i.test(a) ? 'App' : a.split(/[\s/]/)[0].slice(0, 24);
    return [br, os].filter(Boolean).join(' · ');
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const CATS = { acceso: 'Accesos', cuenta: 'Cuentas', admin: 'Administración', app: APP.appCat };

  // ------------------------------------------------------------------ avisos y diálogos
  function toast(text, tone = 'ok') {
    const t = document.createElement('div');
    t.className = `a-toast ${tone}`;
    t.setAttribute('role', tone === 'err' ? 'alert' : 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  function modal(html, { wide = false } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'a-modal';
    wrap.innerHTML = `<div class="a-modal-bg" data-x></div><div class="a-modal-panel ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <button class="a-btn ghost a-modal-x" type="button" data-x aria-label="Cerrar">✕</button>${html}</div>`;
    const before = document.activeElement;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); if (before && before.focus) before.focus(); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    wrap.addEventListener('click', (ev) => { if (ev.target.closest('[data-x]')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    const first = wrap.querySelector('input, select, textarea, .a-modal-panel button:not([data-x])');
    if (first) first.focus();
    return { root: $('.a-modal-panel', wrap), close };
  }

  function confirmBox(title, text, okLabel, danger = false) {
    return new Promise((resolve) => {
      const m = modal(`<h2>${esc(title)}</h2><p class="a-sub">${text}</p>
        <div class="a-actions end"><button class="a-btn" type="button" data-no>Cancelar</button>
        <button class="a-btn ${danger ? 'danger solid' : 'primary'}" type="button" data-ok>${esc(okLabel)}</button></div>`);
      $('[data-ok]', m.root).focus();
      $('[data-no]', m.root).addEventListener('click', () => { m.close(); resolve(false); });
      $('[data-ok]', m.root).addEventListener('click', () => { m.close(); resolve(true); });
    });
  }

  function linkModal(title, intro, out) {
    const m = modal(`<h2>${esc(title)}</h2><p class="a-sub">${esc(intro)}</p>
      <div class="a-copy"><input type="text" readonly value="${esc(out.link)}"><button class="a-btn" type="button" data-copy>Copiar</button></div>
      <p class="a-sub">Caduca el ${esc(date(out.expires_at, true))} y solo sirve una vez. Mándalo por un canal privado
      (Signal, WhatsApp…): quien lo tenga puede usarlo.</p>`);
    const input = $('input', m.root);
    input.select();
    $('[data-copy]', m.root).addEventListener('click', async (ev) => {
      try { await navigator.clipboard.writeText(out.link); ev.target.textContent = 'Copiado'; } catch (err) { input.select(); }
    });
  }

  // ------------------------------------------------------------------ estado y rutas
  const root = document.getElementById('adm');
  let data = null;
  let me = null;
  let timer = null;
  const SECTIONS = [
    ['resumen', 'Resumen'],
    ...APP.sections.map((s) => [s.key, s.label]),
    ['usuarios', 'Usuarios'],
    ['invitaciones', 'Invitaciones'],
    ['sesiones', 'Sesiones'],
    ['registro', 'Registro'],
  ];

  function route() {
    const raw = location.hash.slice(1) || 'resumen';
    const [path, query = ''] = raw.split('?');
    const [sec, id] = path.split('/');
    return { sec: SECTIONS.some(([k]) => k === sec) ? sec : 'resumen', id: id ? Number(id) : null, params: new URLSearchParams(query) };
  }

  function shell() {
    root.innerHTML = `<nav class="a-nav" aria-label="Secciones de administración">
        <p class="a-nav-title">Administración</p>
        ${SECTIONS.map(([k, label]) => `<a href="#${k}" data-sec="${k}">${label}<span class="a-count" data-count="${k}"></span></a>`).join('')}
      </nav>
      <div class="a-main" id="a-main" tabindex="-1"></div>`;
  }

  function counts() {
    if (!data) return;
    const set = (k, n, warn = false) => { const el = $(`[data-count="${k}"]`); if (el) { el.textContent = n ? String(n) : ''; el.classList.toggle('warn', warn); } };
    set('usuarios', data.users.length);
    set('invitaciones', data.invites.length);
    set('sesiones', data.security.sessions);
    set('registro', data.security.failed_24h, data.security.failed_24h > 0);
  }

  async function render() {
    const r = route();
    $$('.a-nav a').forEach((a) => {
      const on = a.dataset.sec === r.sec;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    // Cada pintado va a un contenedor nuevo: así no se acumulan escuchas de la vista anterior.
    const old = $('#a-main');
    const main = old.cloneNode(false);
    old.replaceWith(main);
    try {
      const own = APP.sections.find((s) => s.key === r.sec);
      if (own) await own.render(main, ctx, r);
      else if (r.sec === 'usuarios' && r.id) await renderUser(main, r.id);
      else if (r.sec === 'usuarios') renderUsers(main, r.params);
      else if (r.sec === 'invitaciones') renderInvites(main);
      else if (r.sec === 'sesiones') await renderSessions(main);
      else if (r.sec === 'registro') await renderLog(main, r.params);
      else renderSummary(main);
    } catch (err) {
      main.innerHTML = `<p class="a-msg err">No se ha podido cargar: ${esc(err.message)}</p>`;
    }
    if (APP.afterRender) APP.afterRender(r, ctx);
  }

  async function load({ quiet = false } = {}) {
    data = await api('/api/admin/overview');
    counts();
    if (!quiet) await render();
    clearTimeout(timer);
    if (APP.poll(data)) timer = setTimeout(() => load(), 3000);
  }

  const header = (title, sub, extra = '') => `<header class="a-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="a-sub">${sub}</p>` : ''}</div>${extra}</header>`;
  const tags = (u) => [
    u.is_admin ? '<span class="a-tag accent">admin</span>' : '',
    u.disabled ? '<span class="a-tag danger">desactivado</span>' : '',
    u.id === data.me ? '<span class="a-tag">tú</span>' : '',
  ].join('');
  const kpi = ([label, value, foot = '', tone = '']) => `<div class="a-kpi ${tone}"><p class="a-kpi-t">${esc(label)}</p><p class="a-kpi-v">${value}</p><p class="a-kpi-f">${foot}</p></div>`;

  function eventRows(events, { withUser = true } = {}) {
    if (!events.length) return `<tr><td colspan="5" class="a-empty">Nada que mostrar.</td></tr>`;
    return events.map((e) => `<tr class="${e.level === 'warn' ? 'warn' : ''}">
      <td class="nowrap">${esc(date(e.at, true))}</td>
      <td><span class="a-cat ${esc(e.cat)}">${esc(CATS[e.cat] || e.cat)}</span></td>
      <td><b>${esc(e.kind)}</b>${e.detail ? `<div class="a-sub">${esc(e.detail)}</div>` : ''}</td>
      ${withUser ? `<td>${e.user_id && e.username ? `<a href="#usuarios/${e.user_id}">${esc(e.username)}</a>` : esc(e.username || '—')}${e.actor ? `<div class="a-sub">por ${esc(e.actor)}</div>` : ''}</td>` : `<td>${e.actor ? `por ${esc(e.actor)}` : ''}</td>`}
      <td class="a-mono a-faint">${esc(e.ip || '')}</td></tr>`).join('');
  }

  // ------------------------------------------------------------------ Resumen
  function renderSummary(main) {
    const s = data.security;
    const active = data.users.filter((u) => !u.disabled).length;
    const admins = data.users.filter((u) => u.is_admin && !u.disabled).length;
    const recent30 = data.users.filter((u) => u.last_seen && (Date.now() - toDate(u.last_seen).getTime()) < 30 * 86400000).length;
    const tiles = [
      ['Usuarios', data.users.length, `${active} activos · ${plural(admins, 'admin', 'admins')}`],
      ['Activos en 30 días', recent30, 'con alguna sesión usada'],
      ['Sesiones abiertas', s.sessions, '<a href="#sesiones">ver sesiones</a>'],
      ['Enlaces pendientes', data.invites.length, '<a href="#invitaciones">invitaciones y restablecer</a>'],
      ['Entradas fallidas', s.failed_24h, 'últimas 24 h · <a href="#registro?cat=fallos">ver</a>', s.failed_24h ? 'warn' : ''],
      ...APP.kpis(data),
    ];
    main.innerHTML = `${header('Resumen', `Cuentas y actividad de ${esc(APP.name)}.`)}
      <div class="a-kpis">${tiles.map(kpi).join('')}</div>
      <section class="a-card">
        <div class="a-card-head"><h2>Actividad reciente</h2><a class="a-link" href="#registro">Registro completo →</a></div>
        <div class="a-table-wrap"><table class="a-table"><thead><tr><th>Cuándo</th><th>Tipo</th><th>Qué</th><th>Usuario</th><th>IP</th></tr></thead>
        <tbody>${eventRows(data.recent || [])}</tbody></table></div>
      </section>`;
  }

  // ------------------------------------------------------------------ Usuarios
  function renderUsers(main, params) {
    const q = (params.get('q') || '').toLowerCase();
    const f = params.get('f') || '';
    const users = data.users.filter((u) => (!q || u.username.includes(q))
      && (!f || (f === 'admin' && u.is_admin) || (f === 'activos' && !u.disabled) || (f === 'desactivados' && u.disabled)));
    const rows = users.map((u) => `<tr class="a-click ${u.disabled ? 'off' : ''}" data-go="#usuarios/${u.id}" tabindex="0">
        <td><div class="a-name">${esc(u.username)} ${tags(u)}</div><div class="a-sub">alta ${esc(date(u.created_at))}</div></td>
        ${APP.columns.map((c) => `<td>${c.cell(u)}</td>`).join('')}
        <td>${esc(ago(u.last_seen || u.last_login))}<div class="a-sub">${plural(u.sessions, 'sesión', 'sesiones')}</div></td>
        <td class="a-chev" aria-hidden="true">›</td></tr>`).join('');
    main.innerHTML = `${header('Usuarios', `${plural(data.users.length, 'cuenta', 'cuentas')}. Las altas son solo por invitación.`,
      '<a class="a-btn primary" href="#invitaciones">Invitar a alguien</a>')}
      <div class="a-toolbar">
        <input type="search" id="u-q" placeholder="Buscar usuario" value="${esc(q)}" aria-label="Buscar usuario">
        <select id="u-f" aria-label="Filtrar">
          <option value="">Todos</option><option value="activos">Activos</option><option value="admin">Administradores</option><option value="desactivados">Desactivados</option>
        </select>
      </div>
      <div class="a-card flush"><div class="a-table-wrap"><table class="a-table">
        <thead><tr><th>Usuario</th>${APP.columns.map((c) => `<th>${esc(c.title)}</th>`).join('')}<th>Último acceso</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${APP.columns.length + 3}" class="a-empty">Ningún usuario coincide.</td></tr>`}</tbody>
      </table></div></div>`;
    $('#u-f', main).value = f;
    const update = () => {
      const p = new URLSearchParams();
      if ($('#u-q', main).value.trim()) p.set('q', $('#u-q', main).value.trim());
      if ($('#u-f', main).value) p.set('f', $('#u-f', main).value);
      history.replaceState(null, '', `#usuarios${p.toString() ? `?${p}` : ''}`);
      renderUsers(main, p);
      const input = $('#u-q', main);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    };
    let typing;
    $('#u-q', main).addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(update, 200); });
    $('#u-f', main).addEventListener('change', update);
  }

  // ------------------------------------------------------------------ Ficha de un usuario
  async function renderUser(main, id) {
    const out = await api(`/api/admin/users/${id}`);
    const u = out.user;
    const self = u.id === data.me;
    const facts = [
      ['Alta', esc(date(u.created_at, true))],
      ['Última entrada', esc(date(u.last_login, true))],
      ['Último uso', esc(ago(u.last_seen))],
      ['Rol', u.is_admin ? 'Administrador' : 'Usuario'],
      ['Estado', u.disabled ? '<span class="a-dot bad"></span>Desactivado' : '<span class="a-dot ok"></span>Activo'],
      ...(APP.twoFactor ? [['Verificación en dos pasos', u.totp ? '<span class="a-dot ok"></span>Activada' : '<span class="a-dot"></span>Desactivada']] : []),
      ...APP.facts(u),
    ];
    const common = [
      { id: 'reset', label: `${APP.resetLabel}…` },
      { id: 'logout', label: 'Cerrar todas sus sesiones', hidden: !u.sessions },
      { id: 'admin', label: u.is_admin ? 'Quitar administrador' : 'Hacer administrador', hidden: self },
      { id: 'disable', label: u.disabled ? 'Reactivar' : 'Desactivar', hidden: self },
    ];
    const extra = APP.actions(u, ctx).filter((a) => !a.hidden);
    const sessions = out.sessions.map((s) => `<tr>
        <td>${esc(device(s.agent))}${s.current ? ' <span class="a-tag">esta sesión</span>' : ''}<div class="a-sub a-hide-m" title="${esc(s.agent || '')}">${esc((s.agent || '').slice(0, 70))}</div></td>
        <td class="a-mono">${esc(s.ip || '—')}</td>
        <td>${esc(date(s.created_at, true))}</td>
        <td>${esc(ago(s.last_seen || s.created_at))}</td>
        <td class="right">${s.current ? '' : `<button class="a-btn small" type="button" data-end="${s.id}">Cerrar</button>`}</td></tr>`).join('');
    main.innerHTML = `<a class="a-back" href="#usuarios">‹ Usuarios</a>
      ${header(u.username, tags(u))}
      <div class="a-actions">${[...extra.map((a, i) => `<button class="a-btn" type="button" data-x-act="${i}">${esc(a.label)}</button>`),
        ...common.filter((a) => !a.hidden).map((a) => `<button class="a-btn" type="button" data-act="${a.id}">${esc(a.label)}</button>`)].join('')}</div>
      <section class="a-card"><h2>Datos</h2><dl class="a-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join('')}</dl></section>
      <section class="a-card flush">
        <div class="a-card-head pad"><h2>Sesiones abiertas</h2><span class="a-sub">${plural(out.sessions.length, 'sesión', 'sesiones')}</span></div>
        <div class="a-table-wrap"><table class="a-table"><thead><tr><th>Dispositivo</th><th>IP</th><th>Inicio</th><th>Último uso</th><th></th></tr></thead>
        <tbody>${sessions || '<tr><td colspan="5" class="a-empty">Ninguna.</td></tr>'}</tbody></table></div>
      </section>
      <section class="a-card flush">
        <div class="a-card-head pad"><h2>Actividad</h2><a class="a-link" href="#registro?user=${u.id}">Todo su registro →</a></div>
        <div class="a-table-wrap"><table class="a-table"><thead><tr><th>Cuándo</th><th>Tipo</th><th>Qué</th><th></th><th>IP</th></tr></thead>
        <tbody>${eventRows(out.events, { withUser: false })}</tbody></table></div>
      </section>
      ${self ? '' : `<section class="a-card a-danger-zone"><h2>Zona peligrosa</h2>
        <div class="a-row"><div><b>Borrar la cuenta</b><p class="a-sub">${esc(APP.deleteText(u))}</p></div>
        <button class="a-btn danger" type="button" data-act="delete">Borrar usuario…</button></div></section>`}`;

    main.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-act], [data-x-act], [data-end]');
      if (!b) return;
      if (b.dataset.end) {
        try {
          await api(`/api/admin/sessions/${b.dataset.end}`, { method: 'DELETE' });
          toast('Sesión cerrada.');
          await load();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (b.dataset.xAct !== undefined) { await extra[Number(b.dataset.xAct)].run(u, ctx); return; }
      await userAction(u, b.dataset.act);
    });
  }

  async function userAction(u, what) {
    try {
      if (what === 'reset') {
        const out = await api(`/api/admin/users/${u.id}/reset`, { method: 'POST' });
        linkModal(APP.resetLabel, APP.resetIntro(u), out);
      } else if (what === 'logout') {
        if (!await confirmBox('Cerrar sus sesiones', `«${esc(u.username)}» tendrá que volver a entrar en todos sus dispositivos.`, 'Cerrar sesiones')) return;
        await api(`/api/admin/users/${u.id}/logout`, { method: 'POST' });
        toast(`Sesiones de «${u.username}» cerradas.`);
      } else if (what === 'admin') {
        const to = !u.is_admin;
        if (!await confirmBox(to ? 'Hacer administrador' : 'Quitar administrador',
          to ? `«${esc(u.username)}» podrá ver y gestionar todas las cuentas y el registro.` : `«${esc(u.username)}» dejará de poder entrar en Administración.`,
          to ? 'Hacer administrador' : 'Quitar')) return;
        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { is_admin: to } });
        toast(`«${u.username}» ${to ? 'ahora es' : 'ya no es'} administrador.`);
      } else if (what === 'disable') {
        const to = !u.disabled;
        if (to && !await confirmBox('Desactivar cuenta', `«${esc(u.username)}» no podrá entrar y se cerrarán sus sesiones. Sus datos se quedan; puedes reactivarla cuando quieras.`, 'Desactivar', true)) return;
        await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { disabled: to } });
        toast(`«${u.username}» ${to ? 'desactivado' : 'reactivado'}.`);
      } else if (what === 'delete') {
        deleteModal(u);
        return;
      }
      await load();
    } catch (err) { toast(err.message, 'err'); }
  }

  function deleteModal(u) {
    const m = modal(`<h2>Borrar «${esc(u.username)}»</h2><p class="a-sub">${esc(APP.deleteText(u))}</p>
      <form class="a-form" novalidate>
        <label>Escribe <b>${esc(u.username)}</b> para confirmar<input type="text" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <div class="a-actions end"><button class="a-btn" type="button" data-x>Cancelar</button><button class="a-btn danger solid" type="submit" disabled>Borrar para siempre</button></div>
        <p class="a-msg err" role="alert"></p>
      </form>`);
    const input = $('input', m.root);
    const ok = $('button[type=submit]', m.root);
    input.addEventListener('input', () => { ok.disabled = input.value.trim().toLowerCase() !== u.username; });
    $('form', m.root).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api(`/api/admin/users/${u.id}`, { method: 'DELETE', body: { confirm: input.value.trim() } });
        m.close();
        toast(`«${u.username}» borrado.`);
        location.hash = '#usuarios';
        await load();
      } catch (err) { $('.a-msg', m.root).textContent = err.message; }
    });
  }

  // ------------------------------------------------------------------ Invitaciones
  function renderInvites(main) {
    const rows = data.invites.map((i) => `<tr>
      <td>${i.kind === 'alta' ? `Alta${i.is_admin ? ' <span class="a-tag accent">admin</span>' : ''}` : esc(APP.resetLabel.replace(/^Enlace para /, '').replace(/^./, (c) => c.toUpperCase()))}</td>
      <td>${i.kind === 'alta' ? esc(i.note || '—') : `<a href="#usuarios/${i.user_id || ''}">${esc(i.username || '—')}</a>`}</td>
      <td>${esc(date(i.created_at, true))}<div class="a-sub">por ${esc(i.created_by || 'consola')}</div></td>
      <td>${esc(date(i.expires_at, true))}<div class="a-sub">${esc(ago(i.expires_at))}</div></td>
      <td class="right"><button class="a-btn small danger" type="button" data-revoke="${i.id}">Anular</button></td></tr>`).join('');
    main.innerHTML = `${header('Invitaciones', 'Las cuentas solo nacen de un enlace de un solo uso. Caducan solas: el de alta a los 7 días, el de restablecer a las 48 h.')}
      <section class="a-card"><h2>Nueva invitación</h2>
        <form class="a-form inline" id="inv" novalidate>
          <label><span>Para quién es <span class="a-faint">(solo lo ves tú)</span></span><input id="inv-note" type="text" maxlength="80" placeholder="p. ej. Pepe"></label>
          <label class="a-check"><input type="checkbox" id="inv-admin"> Será administrador</label>
          <button class="a-btn primary" type="submit">Crear enlace</button>
        </form>
        <p class="a-sub">${esc(APP.inviteIntro)}</p>
      </section>
      <section class="a-card flush">
        <div class="a-card-head pad"><h2>Enlaces pendientes</h2><span class="a-sub">sin usar y sin caducar</span></div>
        <div class="a-table-wrap"><table class="a-table"><thead><tr><th>Tipo</th><th>Para</th><th>Creado</th><th>Caduca</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="a-empty">No hay enlaces pendientes.</td></tr>'}</tbody></table></div>
      </section>`;
    $('#inv', main).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const admin = $('#inv-admin', main).checked;
      if (admin && !await confirmBox('Invitar a un administrador', 'Podrá ver y gestionar todas las cuentas y el registro.', 'Crear enlace')) return;
      try {
        const out = await api('/api/admin/invites', { method: 'POST', body: { note: $('#inv-note', main).value, is_admin: admin } });
        linkModal('Enlace de alta', APP.inviteIntro, out);
        await load();
      } catch (err) { toast(err.message, 'err'); }
    });
    main.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-revoke]');
      if (!b) return;
      try {
        await api(`/api/admin/invites/${b.dataset.revoke}`, { method: 'DELETE' });
        toast('Enlace anulado.');
        await load();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  // ------------------------------------------------------------------ Sesiones
  async function renderSessions(main) {
    const { sessions } = await api('/api/admin/sessions');
    const rows = sessions.map((s) => `<tr>
      <td><a href="#usuarios/${s.user_id}">${esc(s.username)}</a></td>
      <td>${esc(device(s.agent))}${s.current ? ' <span class="a-tag">esta sesión</span>' : ''}</td>
      <td class="a-mono">${esc(s.ip || '—')}</td>
      <td>${esc(date(s.created_at, true))}</td>
      <td>${esc(ago(s.last_seen || s.created_at))}</td>
      <td>${esc(date(s.expires_at))}</td>
      <td class="right">${s.current ? '' : `<button class="a-btn small" type="button" data-end="${s.id}">Cerrar</button>`}</td></tr>`).join('');
    main.innerHTML = `${header('Sesiones', 'Dispositivos con la sesión abierta. Cerrar una obliga a volver a entrar en ese dispositivo.')}
      <div class="a-card flush"><div class="a-table-wrap"><table class="a-table">
        <thead><tr><th>Usuario</th><th>Dispositivo</th><th>IP</th><th>Inicio</th><th>Último uso</th><th>Caduca</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="a-empty">No hay sesiones abiertas.</td></tr>'}</tbody></table></div></div>`;
    main.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-end]');
      if (!b) return;
      try {
        await api(`/api/admin/sessions/${b.dataset.end}`, { method: 'DELETE' });
        toast('Sesión cerrada.');
        await load();
      } catch (err) { toast(err.message, 'err'); }
    });
  }

  // ------------------------------------------------------------------ Registro
  async function renderLog(main, params) {
    const cat = params.get('cat') || '';
    const user = params.get('user') || '';
    const q = params.get('q') || '';
    const chips = [['', 'Todo'], ['acceso', CATS.acceso], ['cuenta', CATS.cuenta], ['admin', CATS.admin],
      ...(APP.appCat ? [['app', CATS.app]] : []), ['fallos', 'Fallos']];
    main.innerHTML = `${header('Registro', 'Quién hizo qué y cuándo: entradas, altas, cambios de cuentas y lo propio de la app. Las IP sirven para detectar intentos ajenos.')}
      <div class="a-toolbar">
        <div class="a-chips" role="group" aria-label="Tipo">${chips.map(([k, l]) => `<button type="button" class="a-chip ${k === cat ? 'on' : ''}" data-cat="${k}" aria-pressed="${k === cat}">${esc(l)}</button>`).join('')}</div>
        <select id="l-user" aria-label="Usuario"><option value="">Todos los usuarios</option>${data.users.map((u) => `<option value="${u.id}">${esc(u.username)}</option>`).join('')}</select>
        <input type="search" id="l-q" placeholder="Buscar (texto, IP…)" value="${esc(q)}" aria-label="Buscar en el registro">
      </div>
      <div class="a-card flush"><div class="a-table-wrap"><table class="a-table">
        <thead><tr><th>Cuándo</th><th>Tipo</th><th>Qué</th><th>Usuario</th><th>IP</th></tr></thead>
        <tbody id="l-rows"><tr><td colspan="5" class="a-empty">Cargando…</td></tr></tbody></table></div></div>
      <div class="a-actions center"><button class="a-btn" type="button" id="l-more" hidden>Cargar más</button></div>`;
    $('#l-user', main).value = user;
    const base = new URLSearchParams();
    if (cat) base.set('cat', cat);
    if (user) base.set('user', user);
    if (q) base.set('q', q);
    let last = null;
    const fetchPage = async (append) => {
      const p = new URLSearchParams(base);
      p.set('limit', '100');
      if (append && last) p.set('before', String(last));
      const out = await api(`/api/admin/events?${p}`);
      const tbody = $('#l-rows', main);
      if (!tbody) return;
      if (append) tbody.insertAdjacentHTML('beforeend', eventRows(out.events));
      else tbody.innerHTML = eventRows(out.events);
      last = out.events.length ? out.events[out.events.length - 1].id : last;
      $('#l-more', main).hidden = !out.more;
    };
    const go = (changes) => {
      const p = new URLSearchParams(base);
      Object.entries(changes).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
      location.hash = `#registro${p.toString() ? `?${p}` : ''}`;
    };
    $$('[data-cat]', main).forEach((b) => b.addEventListener('click', () => go({ cat: b.dataset.cat })));
    $('#l-user', main).addEventListener('change', (ev) => go({ user: ev.target.value }));
    $('#l-q', main).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go({ q: ev.target.value.trim() }); });
    $('#l-q', main).addEventListener('search', (ev) => { if (!ev.target.value) go({ q: '' }); });
    $('#l-more', main).addEventListener('click', () => fetchPage(true).catch((err) => toast(err.message, 'err')));
    await fetchPage(false);
  }

  // ------------------------------------------------------------------ arranque
  const ctx = { api, toast, modal, confirmBox, linkModal, esc, date, ago, bytes, header, kpi, plural, $, $$, reload: () => load(), get data() { return data; }, get me() { return me; } };
  window.ADMIN_CTX = ctx;

  document.addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-go]');
    if (row && !ev.target.closest('a, button, input, select')) location.hash = row.dataset.go;
  });
  document.addEventListener('keydown', (ev) => {
    const row = ev.target.closest && ev.target.closest('[data-go]');
    if (row && ev.key === 'Enter') location.hash = row.dataset.go;
  });
  window.addEventListener('hashchange', () => {
    window.scrollTo(0, 0);
    render().then(() => { const m = $('#a-main'); if (m) m.focus({ preventScroll: true }); });
  });

  (async () => {
    shell();
    if (APP.init) me = await APP.init(ctx);
    await load();
  })().catch((err) => { root.innerHTML = `<p class="a-msg err">No se ha podido cargar: ${esc(err.message)}</p>`; });
})();

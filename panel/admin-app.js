/* Lo propio de SoloQ Crew en la administración común (admin.js): secciones Novedades, Jugadores y Retos, y el estado
   del actualizador en el resumen. Todo se guarda con /api/admin/soloq/* y el actualizador lo aplica en su siguiente
   pasada (la web filtra las novedades al momento). */
(() => {
  'use strict';
  let cfg = null;                       // lo que devuelve /api/admin/soloq
  const cargar = async (ctx, forzar = false) => {
    if (!cfg || forzar) cfg = await ctx.api('/api/admin/soloq');
    return cfg;
  };
  const copia = (o) => JSON.parse(JSON.stringify(o));

  // Escribe un valor en un objeto siguiendo una ruta «a.0.b».
  function poner(obj, ruta, valor) {
    const ks = ruta.split('.');
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = valor;
  }
  // Enlaza los campos con data-b="ruta" al objeto de estado.
  function enlazar(main, estado, alCambiar) {
    const leer = (el) => (el.type === 'checkbox' ? el.checked : el.value);
    const f = (ev) => {
      const el = ev.target.closest('[data-b]');
      if (!el || el.dataset.t) return;
      poner(estado, el.dataset.b, leer(el));
      if (alCambiar) alCambiar(el);
    };
    main.addEventListener('input', f);
    main.addEventListener('change', f);
  }
  const fechaHora = (ctx, ms) => (ms ? `${ctx.date(ms, true)} (${ctx.ago(ms)})` : 'nunca');

  // ------------------------------------------------------------------ Novedades
  async function renderNovedades(main, ctx) {
    const { esc } = ctx;
    const d = await cargar(ctx, true);
    const st = copia(d.ajustes);
    const textos = copia(d.textos);
    const fila = (c) => {
      const a = st.avisos[c.k];
      const params = c.p.map((p) => {
        const v = a.p[p.k];
        const val = Array.isArray(v) ? v.join(', ') : String(v).replace('.', ',');
        const ancho = p.tipo === 'list' ? 'ancho' : '';
        return `<label class="s-param ${ancho}">${esc(p.label)}<input type="text" inputmode="${p.tipo === 'list' ? 'text' : 'decimal'}"
          data-b="avisos.${c.k}.p.${p.k}" data-tipo="${p.tipo}" value="${esc(val)}"></label>`;
      }).join('');
      return `<tr>
        <td><b>${esc(c.nombre)}</b><div class="a-sub">${esc(c.ej)}</div>${params ? `<div class="s-params">${params}</div>` : ''}</td>
        <td class="s-c">${c.soloDiscord ? '<span class="a-faint">—</span>' : `<input type="checkbox" aria-label="Web" data-b="avisos.${c.k}.web" ${a.web ? 'checked' : ''}>`}</td>
        <td class="s-c"><input type="checkbox" aria-label="Discord" data-b="avisos.${c.k}.discord" ${a.discord ? 'checked' : ''}></td>
      </tr>`;
    };
    const tabla = (grupo) => `<div class="a-table-wrap"><table class="a-table s-tabla"><thead><tr><th>Novedad</th><th class="s-c">Web</th><th class="s-c">Discord</th></tr></thead>
      <tbody>${d.catalogo.filter((c) => c.grupo === grupo).map(fila).join('')}</tbody></table></div>`;
    const claves = Object.keys(textos);
    const prueba = d.prueba;
    const estadoPrueba = !prueba ? '' : !prueba.hecha ? `Pedido ${ctx.ago(prueba.pedida)}: sale en la próxima pasada (menos de un minuto).`
      : prueba.ok ? `Último aviso de prueba: enviado ${ctx.ago(prueba.hecha)}.` : `Último aviso de prueba: falló (${esc(prueba.error || 'error')}).`;

    main.innerHTML = `${ctx.header('Novedades', 'Qué sale en la sección Novedades de la web y qué se avisa en Discord. Lo de la web cambia al momento (también lo que ya salió); lo de Discord, desde la siguiente pasada.')}
      <section class="a-card">
        <div class="a-card-head"><h2>Discord</h2></div>
        <div class="a-form inline">
          <label class="a-check"><input type="checkbox" data-b="discord.activo" ${st.discord.activo ? 'checked' : ''}> Mandar avisos a Discord</label>
          <label>Roasts por persona y día<input type="text" inputmode="numeric" class="s-num" data-b="roastsPorDia" value="${st.roastsPorDia}"></label>
          <button class="a-btn" type="button" id="s-prueba">Mandar aviso de prueba</button>
        </div>
        <p class="a-sub" id="s-prueba-msg">${estadoPrueba}</p>
      </section>
      <section class="a-card flush"><div class="a-card-head pad"><h2>Hitos</h2></div>${tabla('hitos')}</section>
      <section class="a-card flush"><div class="a-card-head pad"><h2>Roasts de partida</h2></div>
        <p class="a-sub pad-x">Cada partida nueva pasa por estos avisos en este orden y se queda con el primero que salta. Si desmarcas web y Discord, ese aviso no se busca y la partida puede caer en el siguiente.</p>
        ${tabla('roasts')}</section>
      <section class="a-card">
        <div class="a-card-head"><h2>Textos de los roasts</h2></div>
        <p class="a-sub">Huecos que se rellenan solos: ${d.huecos.map((h) => `<code>{${esc(h)}}</code>`).join(' ')}. La primera palabra es el icono.</p>
        <div class="s-textos">${claves.map((k) => {
          const base = (d.textosBase[k] || {}).texto || '';
          return `<label><span class="a-mono">${esc(k)}</span><input type="text" maxlength="200" data-b="${esc(k)}.texto" data-t="1" value="${esc(textos[k].texto)}" placeholder="${esc(base)}">
            <button class="a-btn ghost small" type="button" data-restaurar="${esc(k)}" ${textos[k].texto === base ? 'hidden' : ''}>De serie</button></label>`;
        }).join('')}</div>
      </section>
      <div class="s-guardar"><span class="a-msg" id="s-msg" role="status"></span><button class="a-btn primary" type="button" id="s-guardar">Guardar cambios</button></div>`;

    let sucio = false;
    const marcar = () => { sucio = true; ctx.$('#s-msg', main).textContent = 'Hay cambios sin guardar.'; };
    // los textos van en su propio objeto
    main.addEventListener('input', (ev) => {
      const el = ev.target;
      if (el.dataset.t) {
        poner(textos, el.dataset.b, el.value);
        const k = el.dataset.b.split('.')[0];
        ctx.$(`[data-restaurar="${CSS.escape(k)}"]`, main).hidden = el.value === ((d.textosBase[k] || {}).texto || '');
        marcar();
      }
    });
    enlazar(main, st, (el) => { if (!el.dataset.t) marcar(); });
    main.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-restaurar]');
      if (!b) return;
      const k = b.dataset.restaurar;
      const inp = ctx.$(`[data-b="${CSS.escape(k)}.texto"]`, main);
      inp.value = d.textosBase[k].texto;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    ctx.$('#s-prueba', main).addEventListener('click', async () => {
      try {
        await ctx.api('/api/admin/soloq/discord-prueba', { method: 'POST' });
        ctx.$('#s-prueba-msg', main).textContent = 'Pedido: el actualizador lo manda en su próxima pasada (menos de un minuto).';
        ctx.toast('Aviso de prueba pedido');
      } catch (err) { ctx.toast(err.message, 'err'); }
    });
    ctx.$('#s-guardar', main).addEventListener('click', async (ev) => {
      // números en español («0,35») y listas tal cual: el servidor las valida
      const env = copia(st);
      main.querySelectorAll('[data-tipo="float"]').forEach((el) => poner(env, el.dataset.b, el.value.replace(',', '.')));
      env.roastsPorDia = Number(env.roastsPorDia);
      ev.target.disabled = true;
      try {
        await ctx.api('/api/admin/soloq/ajustes', { method: 'PUT', body: env });
        await ctx.api('/api/admin/soloq/textos', { method: 'PUT', body: textos });
        sucio = false;
        ctx.$('#s-msg', main).textContent = '';
        ctx.toast('Guardado');
        cfg = null;
      } catch (err) {
        ctx.$('#s-msg', main).textContent = err.message;
        ctx.$('#s-msg', main).classList.add('err');
        ctx.toast(err.message, 'err');
      }
      ev.target.disabled = false;
    });
    avisarAlSalir(() => sucio);
  }

  // ------------------------------------------------------------------ Jugadores
  const TIER_ES = { IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda',
    DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Challenger' };
  async function renderJugadores(main, ctx) {
    const { esc } = ctx;
    const d = await cargar(ctx, true);
    const st = copia(d.jugadores || { title: 'SoloQ Crew', subtitle: '', defaultRegion: 'euw1', players: [] });
    let sucio = false;
    const regiones = (sel, vacia) => (vacia ? `<option value="">por defecto</option>` : '')
      + d.regiones.map((r) => `<option value="${r}" ${r === sel ? 'selected' : ''}>${r.toUpperCase()}</option>`).join('');
    const estadoCuenta = (rid) => {
      const c = d.cuentas[String(rid || '').toLowerCase()];
      if (!c) return '<span class="a-tag">nueva: se descarga en las próximas pasadas</span>';
      if (c.error) return `<span class="a-tag danger" title="${esc(c.error)}">error</span>`;
      if (!c.tier) return `<span class="a-faint">sin clasificar</span>`;
      const div = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(c.tier) ? '' : ` ${c.division}`;
      return `<span class="a-sub">${TIER_ES[c.tier] || c.tier}${div} · ${c.lp} LP · ${c.games} partidas</span>`;
    };
    const pintar = () => {
      main.innerHTML = `${ctx.header('Jugadores', 'Quién sale en el ranking y con qué cuentas. Una cuenta nueva baja su historial en las próximas pasadas del actualizador (puede tardar un rato si tiene muchas partidas).')}
        <section class="a-card">
          <div class="a-card-head"><h2>La web</h2></div>
          <div class="a-form inline">
            <label>Título<input type="text" maxlength="60" data-b="title" value="${esc(st.title)}"></label>
            <label>Subtítulo<input type="text" maxlength="120" data-b="subtitle" value="${esc(st.subtitle)}"></label>
            <label>Región por defecto<select data-b="defaultRegion">${regiones(st.defaultRegion)}</select></label>
          </div>
        </section>
        ${st.players.map((p, i) => `<section class="a-card s-jug">
          <div class="a-card-head">
            <label class="s-nombre">Nombre<input type="text" maxlength="32" data-b="players.${i}.name" value="${esc(p.name)}"></label>
            <div class="a-actions">
              <button class="a-btn ghost small" type="button" data-sube="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
              <button class="a-btn ghost small" type="button" data-baja="${i}" ${i === st.players.length - 1 ? 'disabled' : ''} aria-label="Bajar">↓</button>
              <button class="a-btn danger small" type="button" data-quita="${i}">Quitar</button>
            </div>
          </div>
          ${p.accounts.map((a, j) => `<div class="s-cuenta">
            <label>Riot ID<input type="text" maxlength="24" placeholder="Nombre#TAG" data-b="players.${i}.accounts.${j}.riotId" value="${esc(a.riotId)}"></label>
            <label>Región<select data-b="players.${i}.accounts.${j}.region">${regiones(a.region || '', true)}</select></label>
            <label>Etiqueta<input type="text" maxlength="24" placeholder="(opcional) smurf, main…" data-b="players.${i}.accounts.${j}.label" value="${esc(a.label || '')}"></label>
            <div class="s-estado">${estadoCuenta(a.riotId)}</div>
            <button class="a-btn ghost small" type="button" data-quitacuenta="${i}.${j}" ${p.accounts.length < 2 ? 'hidden' : ''} aria-label="Quitar cuenta">✕</button>
          </div>`).join('')}
          <div class="a-actions"><button class="a-btn small" type="button" data-masc="${i}">+ Otra cuenta</button></div>
        </section>`).join('')}
        <div class="a-actions"><button class="a-btn" type="button" id="s-mas">+ Añadir jugador</button></div>
        <p class="a-sub">Si cambias el nombre de alguien, las semanas que ganó y los retos guardan el nombre antiguo. Quitar a alguien no borra sus datos: si vuelve a entrar, sigue donde estaba.</p>
        <div class="s-guardar"><span class="a-msg" id="s-msg" role="status">${sucio ? 'Hay cambios sin guardar.' : ''}</span><button class="a-btn primary" type="button" id="s-guardar">Guardar cambios</button></div>`;
    };
    pintar();
    const marcar = () => { sucio = true; ctx.$('#s-msg', main).textContent = 'Hay cambios sin guardar.'; ctx.$('#s-msg', main).classList.remove('err'); };
    enlazar(main, st, marcar);
    main.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      const ds = b.dataset;
      if (ds.sube || ds.baja) {
        const i = Number(ds.sube || ds.baja);
        const k = ds.sube ? i - 1 : i + 1;
        [st.players[i], st.players[k]] = [st.players[k], st.players[i]];
      } else if (ds.quita) {
        const p = st.players[Number(ds.quita)];
        if (!(await ctx.confirmBox(`Quitar a ${p.name || 'este jugador'}`, 'Deja de salir en el ranking al guardar. Sus datos no se borran.', 'Quitar', true))) return;
        st.players.splice(Number(ds.quita), 1);
      } else if (ds.quitacuenta) {
        const [i, j] = ds.quitacuenta.split('.').map(Number);
        st.players[i].accounts.splice(j, 1);
      } else if (ds.masc) {
        st.players[Number(ds.masc)].accounts.push({ riotId: '' });
      } else if (b.id === 's-mas') {
        st.players.push({ name: '', accounts: [{ riotId: '' }] });
      } else if (b.id === 's-guardar') {
        b.disabled = true;
        try {
          const env = copia(st);
          env.players.forEach((p) => p.accounts.forEach((a) => { if (!a.region) delete a.region; if (!a.label) delete a.label; }));
          const out = await ctx.api('/api/admin/soloq/jugadores', { method: 'PUT', body: env });
          Object.assign(st, out.jugadores);
          sucio = false;
          cfg = null;
          ctx.toast('Guardado. Se aplica en la próxima pasada (menos de un minuto).');
          pintar();
        } catch (err) {
          ctx.$('#s-msg', main).textContent = err.message;
          ctx.$('#s-msg', main).classList.add('err');
          b.disabled = false;
        }
        return;
      } else return;
      sucio = true;
      pintar();
      if (b.id === 's-mas') ctx.$(`[data-b="players.${st.players.length - 1}.name"]`, main).focus();
    });
    avisarAlSalir(() => sucio);
  }

  // ------------------------------------------------------------------ Retos
  const TIPOS = { race: 'Carrera: más LP entre dos fechas', target: 'Llegar a un rango', handicap: 'Objetivo de LP por persona', games: 'Constancia: partidas por semana' };
  async function renderRetos(main, ctx) {
    const { esc } = ctx;
    const d = await cargar(ctx, true);
    const st = { retos: copia(d.retos || []) };
    const nombres = ((d.jugadores || {}).players || []).map((p) => p.name);
    let sucio = false;
    const hoy = new Date().toISOString().slice(0, 10);
    const estado = (r) => (r.to < hoy ? '<span class="a-tag">terminado</span>' : r.from > hoy ? '<span class="a-tag">próximo</span>' : '<span class="a-tag accent">en curso</span>');
    const pintar = () => {
      main.innerHTML = `${ctx.header('Retos', 'Competiciones con fechas. Salen en la web y, al empezar y al terminar, en Novedades y Discord.')}
        ${st.retos.length ? '' : '<p class="a-sub">No hay retos.</p>'}
        ${st.retos.map((r, i) => {
          const todos = r.players === 'all';
          const extra = r.type === 'target'
            ? `<label>Rango objetivo<input type="text" maxlength="20" placeholder="Diamante IV" data-b="retos.${i}.target" value="${esc(r.target || '')}"></label>`
            : r.type === 'handicap'
              ? `<label>Objetivo de LP por defecto<input type="text" inputmode="numeric" class="s-num" data-b="retos.${i}.target" value="${esc(r.target ?? 100)}"></label>
                 <div class="s-objetivos">${(todos ? nombres : r.players).map((n) => `<label>${esc(n)}<input type="text" inputmode="numeric" class="s-num" data-obj="${i}" data-n="${esc(n)}" value="${esc((r.targets || {})[n] ?? '')}" placeholder="${esc(r.target ?? 100)}"></label>`).join('')}</div>`
              : r.type === 'games'
                ? `<label>Partidas por semana<input type="text" inputmode="numeric" class="s-num" data-b="retos.${i}.perWeek" value="${esc(r.perWeek ?? 10)}"></label>` : '';
          return `<section class="a-card">
            <div class="a-card-head"><h2>${esc(r.title || 'Reto nuevo')} ${r.from && r.to ? estado(r) : ''}</h2><button class="a-btn danger small" type="button" data-quita="${i}">Quitar</button></div>
            <div class="a-form">
              <div class="a-form inline">
                <label>Título<input type="text" maxlength="60" data-b="retos.${i}.title" value="${esc(r.title)}"></label>
                <label>Tipo<select data-b="retos.${i}.type" data-repinta="1">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === r.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
              </div>
              <div class="a-form inline">
                <label>Desde<input type="date" data-b="retos.${i}.from" value="${esc(r.from)}"></label>
                <label>Hasta (incluido)<input type="date" data-b="retos.${i}.to" value="${esc(r.to)}"></label>
                ${extra.includes('s-objetivos') ? '' : extra}
              </div>
              ${extra.includes('s-objetivos') ? `<div class="a-form">${extra}</div>` : ''}
              <label>Descripción<input type="text" maxlength="300" data-b="retos.${i}.desc" value="${esc(r.desc)}"></label>
              <label>Premio o castigo (opcional)<input type="text" maxlength="120" data-b="retos.${i}.stake" value="${esc(r.stake)}"></label>
              <div class="s-quien"><span class="a-sub">Participan</span>
                <label class="a-check"><input type="checkbox" data-todos="${i}" ${todos ? 'checked' : ''}> Todos</label>
                ${todos ? '' : nombres.map((n) => `<label class="a-check"><input type="checkbox" data-pl="${i}" data-n="${esc(n)}" ${r.players.includes(n) ? 'checked' : ''}> ${esc(n)}</label>`).join('')}
              </div>
            </div>
          </section>`;
        }).join('')}
        <div class="a-actions"><button class="a-btn" type="button" id="s-mas">+ Nuevo reto</button></div>
        <div class="s-guardar"><span class="a-msg" id="s-msg" role="status">${sucio ? 'Hay cambios sin guardar.' : ''}</span><button class="a-btn primary" type="button" id="s-guardar">Guardar cambios</button></div>`;
    };
    pintar();
    const marcar = () => { sucio = true; const m = ctx.$('#s-msg', main); m.textContent = 'Hay cambios sin guardar.'; m.classList.remove('err'); };
    enlazar(main, st, (el) => { marcar(); if (el.dataset.repinta) pintar(); });
    main.addEventListener('change', (ev) => {
      const el = ev.target;
      if (el.dataset.todos !== undefined) {
        const r = st.retos[Number(el.dataset.todos)];
        r.players = el.checked ? 'all' : [...nombres];
        marcar();
        pintar();
      } else if (el.dataset.pl !== undefined) {
        const r = st.retos[Number(el.dataset.pl)];
        r.players = el.checked ? [...r.players, el.dataset.n] : r.players.filter((x) => x !== el.dataset.n);
        marcar();
      }
    });
    main.addEventListener('input', (ev) => {
      const el = ev.target;
      if (el.dataset.obj === undefined) return;
      const r = st.retos[Number(el.dataset.obj)];
      r.targets = r.targets || {};
      if (el.value.trim()) r.targets[el.dataset.n] = el.value.trim(); else delete r.targets[el.dataset.n];
      marcar();
    });
    main.addEventListener('click', async (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      if (b.dataset.quita) {
        const r = st.retos[Number(b.dataset.quita)];
        if (!(await ctx.confirmBox(`Quitar «${r.title || 'reto'}»`, 'Deja de salir en la web al guardar.', 'Quitar', true))) return;
        st.retos.splice(Number(b.dataset.quita), 1);
      } else if (b.id === 's-mas') {
        const fin = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
        st.retos.push({ title: '', type: 'race', from: hoy, to: fin, players: 'all', desc: '', stake: '' });
      } else if (b.id === 's-guardar') {
        b.disabled = true;
        try {
          const out = await ctx.api('/api/admin/soloq/retos', { method: 'PUT', body: st.retos });
          st.retos = out.retos;
          sucio = false;
          cfg = null;
          ctx.toast('Guardado. Se aplica en la próxima pasada.');
          pintar();
        } catch (err) {
          ctx.$('#s-msg', main).textContent = err.message;
          ctx.$('#s-msg', main).classList.add('err');
          b.disabled = false;
        }
        return;
      } else return;
      marcar();
      pintar();
    });
    avisarAlSalir(() => sucio);
  }

  // Aviso del navegador si se cierra la página con cambios sin guardar (y al cambiar de sección dentro de /admin).
  let pendiente = () => false;
  function avisarAlSalir(fn) { pendiente = fn; }
  window.addEventListener('beforeunload', (ev) => { if (pendiente()) { ev.preventDefault(); ev.returnValue = ''; } });
  window.addEventListener('hashchange', () => { pendiente = () => false; }, true);

  // ------------------------------------------------------------------ resumen
  const hace = (ms) => {
    if (!ms) return 'nunca';
    const m = (Date.now() - ms) / 60000;
    return m < 1 ? 'hace un momento' : m < 60 ? `hace ${Math.round(m)} min` : m < 2160 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`;
  };
  const limpio = (s) => String(s || '').replace(/[<>&]/g, '');

  window.ADMIN = {
    name: 'soloq',
    twoFactor: true,
    appCat: 'SoloQ',
    sections: [
      { key: 'novedades', label: 'Novedades', render: renderNovedades },
      { key: 'jugadores', label: 'Jugadores', render: renderJugadores },
      { key: 'retos', label: 'Retos', render: renderRetos },
    ],
    kpis: (d) => {
      const p = (d.server && d.server.pasada) || {};
      const vivo = d.server && d.server.latido && Date.now() - d.server.latido < 5 * 60e3;
      const err = p.err === 'key' ? 'la clave de Riot ha caducado' : p.err ? limpio(p.msg || p.err) : '';
      const cuentas = (p.accErr || []).length ? `fallan: ${limpio(p.accErr.join(', '))}` : '';
      return [
        ['Actualizador', vivo ? 'en marcha' : 'parado', vivo ? `última pasada ${hace(p.at)}${p.full ? ' (completa)' : ''} · ${p.calls || 0} peticiones a Riot` : `último latido ${hace(d.server && d.server.latido)}`, vivo ? '' : 'warn'],
        ['Última pasada', p.ok ? 'bien' : p.at ? 'con error' : '—', err || cuentas || 'sin errores', p.ok && !cuentas ? '' : 'warn'],
      ];
    },
    resetLabel: 'Enlace para restablecer el acceso',
    resetIntro: (u) => `Con este enlace «${u.username}» pone una contraseña nueva. Si tenía la verificación en dos pasos, se desactiva (por si ha perdido el móvil) y puede volver a activarla en «cuenta».`,
    inviteIntro: 'Con este enlace la persona elige su usuario y su contraseña. Solo los administradores entran en /admin; el ranking es público y no necesita cuenta.',
    deleteText: () => 'Se borra su cuenta (el ranking no se toca). No se puede deshacer.',
  };
})();

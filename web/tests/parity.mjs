// Paridad entre la web antigua (raíz del repo: index.html + app.js) y la nueva (web/dist, React).
// Sirve las dos con los mismos datos, congela la hora, falsea las imágenes externas y el latido, y repite
// los mismos pasos en las dos comparando el DOM normalizado y una captura (pixelmatch) en cada paso.
//
//   npm run build && npm run test:parity        (usa Edge instalado: chromium.launch({ channel: 'msedge' }))
//   PARITY_ONLY=semana npm run test:parity      solo los pasos cuyo nombre contenga "semana"
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const WEB = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO = resolve(WEB, '..');
const DIST = join(WEB, 'dist');
const OUT = join(WEB, 'tests', 'out');
const ONLY = process.env.PARITY_ONLY || '';
// Proporción de píxeles distintos admitida: 0,05 %. Lo que queda por debajo (y se lista en la tabla) son bordes
// de texto o de círculos con un suavizado distinto por cómo agrupa el navegador las capas, no cambios visibles.
const PIXEL_MAX = 0.0005;

if (!existsSync(join(DIST, 'index.html'))) { console.error('Falta web/dist: ejecuta antes "npm run build"'); process.exit(2); }
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- datos
const REAL = JSON.parse(readFileSync(join(REPO, 'data', 'data.json'), 'utf8'));
const T = Date.parse(REAL.generatedAt) + 5 * 60e3;   // "ahora" en las dos webs

// Variante sacada de los datos reales para pasar por las ramas que hoy no salen (varias cuentas, rivales,
// Clash, retos de cada tipo, jugador sin clasificar ni partidas, cuenta con error…)
function variant() {
  const d = structuredClone(REAL);
  const p1 = d.players[1];
  const smurf = structuredClone(p1.accounts[0]);
  Object.assign(smurf, { key: 'smurf#euw', riotId: 'Smurfeo#EUW', gameName: 'Smurfeo', tagLine: 'EUW', error: 'Riot no responde' });
  smurf.recent = smurf.recent.slice(0, 5);
  p1.accounts.push(smurf);
  d.players.push({ name: 'Nuevo', links: [], bestAccount: 0, accounts: [{ key: 'nuevo#euw', riotId: 'Nuevo#EUW', gameName: 'Nuevo', tagLine: 'EUW', rank: null, stats: null, recent: [], lpHist: [], seq: [] }] });
  const duo = d.duos[0];
  d.rivals = [{ a: duo.a, b: duo.b, aWins: 3, bWins: 2, recent: duo.recent.slice(0, 5).map((g) => ({ ...g, aWin: g.win })) }];
  d.flex.clash = d.flex.recent.slice(0, 4).map((g) => ({ ...g, q: 700 }));
  const names = d.players.slice(0, 4).map((p) => p.name);
  const day = 864e5;
  d.challenges.push(
    { id: 'meta', title: 'A Diamante', type: 'target', desc: 'Llegar a Diamante IV', stake: 'una cena', from: T - 10 * day, to: T + 20 * day, target: 'DIAMOND IV', perWeek: null,
      standings: names.map((n, i) => ({ name: n, value: [1, 0.6, 0.3, 0][i], done: i === 0, label: ['Hecho', '60 %', '30 %', '0 %'][i] })), winners: null },
    { id: 'constancia', title: 'Constancia', type: 'games', desc: '', stake: '', from: T - 30 * day, to: T - day, target: null, perWeek: 5,
      standings: names.map((n, i) => ({ name: n, weeks: [5, 6, 2 + i, 7].slice(0, 3 + (i % 2)), done: i < 2, label: `${i} sem.` })), winners: [names[0], names[1]] },
    { id: 'handicap', title: 'Hándicap', type: 'handicap', desc: 'Cada uno con su objetivo\nsegunda línea', stake: 'birras', from: T + 3 * day, to: T + 33 * day, target: null, perWeek: null,
      standings: names.map((n) => ({ name: n, value: 0, label: '0 LP' })), winners: null },
  );
  d.week.current.coward = { name: names[2], n: 2, of: 5 };
  d.week.current.pentas = [{ ...d.week.current.gotw, name: names[0] }];
  d.events.unshift(
    { name: names[0], key: 'x', type: 'penta', t: T - 30 * 60e3, gameId: d.players[0].accounts[0].recent[0].id, champ: 'Chogath', k: 20, d: 2, a: 5, win: true, id: 'penta:1', text: '🖐️ Pentakill de prueba' },
    { name: names[1], key: 'y', type: 'challengeEnd', t: T - 60 * 60e3, title: 'Carrera', desc: 'Primera línea\nsegunda', id: 'ch:1', text: '🏁 Termina el reto' },
  );
  return d;
}

// Latido falso, igual para las dos: partidas en curso para que salga "Jugando ahora"
function latido(kind) {
  const live = [{ id: 1, q: 420, s: T - 12 * 60e3, p: [{ n: 'xALOzZ', c: 'Jinx', tm: 100 }, { n: 'xPATQ', c: 'Thresh', tm: 100 }] }];
  if (kind === 'variante') live.push({ id: 2, q: 440, s: T - 3 * 60e3, p: [{ n: 'xPeris', c: null, tm: 100 }, { n: 'FesAo 11', c: 'Lux', tm: 200 }] });
  return { beat: T - 60e3, status: { v: 1, at: T - 60e3, ok: true, full: false, err: null, msg: null, live, liveErr: null, accErr: kind === 'variante' ? ['Nuevo'] : [], calls: 3 } };
}

// ---------------------------------------------------------------- servidor estático
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
function fileFor(root, dataDirs, url) {
  let path = decodeURIComponent(new URL(url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const dirs = path.startsWith('/data/') ? dataDirs.map((d) => [d, path.slice(6)]) : [[root, path.slice(1)]];
  for (const [dir, rel] of dirs) {
    const f = join(dir, rel);
    if (!f.startsWith(dir) || !existsSync(f)) continue;
    try { return { status: 200, contentType: TYPES[extname(f)] ?? 'application/octet-stream', body: readFileSync(f) }; } catch { /* carpeta */ }
  }
  return { status: 404, contentType: 'text/plain', body: 'no' };
}
// Servidor de verdad (solo para la prueba sin conexión: el service worker necesita uno)
function serve(root, dataDirs) {
  const srv = createServer((req, res) => {
    const f = fileFor(root, dataDirs, req.url);
    res.writeHead(f.status, { 'Content-Type': f.contentType, 'Cache-Control': 'no-cache' });
    res.end(f.body);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, url: `http://localhost:${srv.address().port}/` })));
}

// Imagen falsa para ddragon / communitydragon: un cuadrado gris, siempre la misma
const FAKE_PNG = (() => {
  const p = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < p.data.length; i += 4) { p.data[i] = 120; p.data[i + 1] = 130; p.data[i + 2] = 140; p.data[i + 3] = 255; }
  return PNG.sync.write(p);
})();

// ---------------------------------------------------------------- DOM normalizado (se ejecuta en la página)
// - se quita el <div id="root"> de React (display: contents) y los <script>/<noscript>/comentarios
// - atributos ordenados; class como conjunto de clases (sin vacías: class="" = sin class)
// - style a través del CSSOM (mismo significado aunque se escriba distinto) y style vacío = sin style
// - <option selected>: atributo inicial (h()) frente a propiedad (React); se compara el valor del <select>
// - texto: los espacios en blanco se colapsan; los que llevan salto de línea al borde son formato del HTML
// - ids de degradados del SVG (eg1, eg2… dependen de cuántas veces se ha dibujado) se numeran por orden
function serialize(selectors) {
  const out = [];
  const attrs = (el) => {
    const list = [];
    for (const a of el.attributes) {
      let v = a.value;
      if (a.name === 'class') { v = v.split(/\s+/).filter(Boolean).sort().join(' '); if (!v) continue; }
      if (a.name === 'style') {
        const s = el.style;
        const parts = [];
        for (let i = 0; i < s.length; i++) parts.push(`${s[i]}: ${s.getPropertyValue(s[i]).trim()}`);
        v = parts.sort().join('; ');
        if (!v) continue;
      }
      if (a.name === 'selected' && el.tagName === 'OPTION') continue;
      list.push(`${a.name}="${v}"`);
    }
    if (el.tagName === 'SELECT') list.push(`(value)="${el.value}"`);
    if (el.tagName === 'INPUT') list.push(`(value)="${el.value}"`);
    return list.sort().join(' ');
  };
  const text = (raw) => {
    let t = raw;
    t = t.replace(/^\s*\n\s*/, '').replace(/\s*\n\s*$/, '');
    return t.replace(/\s+/g, ' ');
  };
  const walk = (node, depth) => {
    const kids = [];
    for (const c of node.childNodes) {
      if (c.nodeType === 8) continue;
      if (c.nodeType === 1 && (c.tagName === 'SCRIPT' || c.tagName === 'NOSCRIPT')) continue;
      if (c.nodeType === 1 && c.id === 'root' && c.parentElement === document.body) { kids.push(...c.childNodes); continue; }
      kids.push(c);
    }
    // textos seguidos = uno
    const merged = [];
    for (const c of kids) {
      if (c.nodeType === 3) {
        if (merged.length && typeof merged.at(-1) === 'string') merged[merged.length - 1] += c.data;
        else merged.push(c.data);
      } else if (c.nodeType === 1) {
        if (c.id === 'root' && c.parentElement === document.body) continue;
        merged.push(c);
      }
    }
    for (const c of merged) {
      if (typeof c === 'string') {
        const t = text(c);
        if (t !== '' && !(t === ' ' && /\n/.test(c))) out.push(`${'  '.repeat(depth)}"${t}"`);
      } else {
        out.push(`${'  '.repeat(depth)}<${c.tagName.toLowerCase()}${c.attributes.length || c.tagName === 'SELECT' || c.tagName === 'INPUT' ? ` ${attrs(c)}` : ''}>`);
        walk(c, depth + 1);
      }
    }
  };
  for (const sel of selectors) {
    const els = sel === 'body' ? [document.body] : [...document.querySelectorAll(sel)];
    out.push(`## ${sel} (${els.length})`);
    for (const el of els) {
      if (sel !== 'body') out.push(`<${el.tagName.toLowerCase()} ${attrs(el)}>`);
      walk(el, 1);
    }
  }
  out.push(`## title: ${document.title}`);
  out.push(`## body.class: ${document.body.className.split(/\s+/).filter(Boolean).sort().join(' ')}`);
  out.push(`## hash: ${location.hash}`);
  let s = out.join('\n');
  const ids = new Map();
  s = s.replace(/\beg(\d+)(?=[lfm]\b)/g, (m) => { if (!ids.has(m)) ids.set(m, `eg#${ids.size + 1}`); return ids.get(m); });
  return s;
}

// ---------------------------------------------------------------- navegador
const browser = await chromium.launch({ channel: 'msedge' });
const results = [];
const scrollNotes = [];   // pasos en los que la posición de scroll acaba distinta (se informa, no se compara)

// Las dos webs se cargan en la misma dirección (cada una en su contexto): así coinciden la dirección que
// llevan el texto para WhatsApp y la imagen, y el origen de localStorage
const ORIGIN = 'https://soloq.test/';   // https: contexto seguro (portapapeles)
async function side(kind, which, width, root, dataDirs) {
  const mobile = width < 600;
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 900 },
    deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
    userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' : undefined,
    locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block', acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  context.setDefaultTimeout(8000);
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(T));
  // Compartir: sin hoja de compartir del sistema, para que acabe en descarga (igual en las dos)
  await page.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true }); });
  await page.route(/^https:\/\/(ddragon\.leagueoflegends\.com|raw\.communitydragon\.org)\//, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: FAKE_PNG }));
  await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|api\.github\.com)\//, (r) => r.abort());
  await page.route(`${ORIGIN}**`, (r) => r.fulfill(fileFor(root, dataDirs, r.request().url())));
  await page.route(/\/api\/latido/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(latido(kind)) }));
  // Peticiones en curso, para esperar a que todo esté quieto
  let pending = 0;
  page.on('request', () => { pending++; });
  page.on('requestfinished', () => { pending--; });
  page.on('requestfailed', () => { pending--; });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  return { context, page, which, errors, pendingNow: () => pending };
}

async function settle(s) {
  for (let i = 0; i < 100; i++) {
    if (s.pendingNow() <= 0) break;
    await s.page.waitForTimeout(25);
  }
  await s.page.waitForTimeout(120);
  await s.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await s.page.waitForTimeout(30);
}

async function shot(s, target) {
  // Imágenes "lazy": que carguen todas antes de la captura (se hace después de leer el DOM)
  await s.page.evaluate(async () => {
    window.__lazy = [...document.querySelectorAll('img[loading="lazy"]')];
    for (const i of window.__lazy) i.loading = 'eager';
    await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); }))));
  });
  const opts = { animations: 'disabled', caret: 'hide' };
  let buf = null;
  // (la cabecera es fija: en una captura de la página entera sale donde esté el scroll, así que se sube antes)
  if (target === 'page') { await s.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); buf = await s.page.screenshot({ ...opts, fullPage: true }); }
  else if (target === 'viewport') buf = await s.page.screenshot(opts);
  else {
    // Página entera recortada a la caja del elemento: sin hacer scroll (que movería la cabecera fija y el
    // :hover según cómo haya quedado cada página) y con el mismo punto de partida en las dos
    await s.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    const loc = s.page.locator(target).first();
    if ((await loc.count()) && (await loc.isVisible())) {
      const box = await loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; });
      buf = await s.page.screenshot({ ...opts, fullPage: true, clip: box });
    }
  }
  // y se deja como estaba, para no ensuciar el DOM de los pasos siguientes
  await s.page.evaluate(() => { for (const i of window.__lazy ?? []) i.loading = 'lazy'; });
  return buf;
}

function pixelDiff(a, b, name) {
  if (!a && !b) return { ratio: 0, note: 'sin captura' };
  if (!a || !b) return { ratio: 1, note: 'falta una captura' };
  const A = PNG.sync.read(a), B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) {
    writeFileSync(join(OUT, `${name}.old.png`), a); writeFileSync(join(OUT, `${name}.new.png`), b);
    return { ratio: 1, note: `tamaño ${A.width}x${A.height} vs ${B.width}x${B.height}` };
  }
  const D = new PNG({ width: A.width, height: A.height });
  // threshold 0.05: no cuenta el tramado de los degradados (±2/255); el suavizado de bordes lo descarta pixelmatch
  const n = pixelmatch(A.data, B.data, D.data, A.width, A.height, { threshold: 0.05 });
  if (n) { writeFileSync(join(OUT, `${name}.old.png`), a); writeFileSync(join(OUT, `${name}.new.png`), b); writeFileSync(join(OUT, `${name}.diff.png`), PNG.sync.write(D)); }
  return { ratio: n / (A.width * A.height), note: `${A.width}x${A.height}` };
}

function firstDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return `línea ${i + 1}:\n    antes: ${x[i] ?? '(nada)'}\n    ahora: ${y[i] ?? '(nada)'}`;
  return '';
}

// ---------------------------------------------------------------- pasos
// Cada paso: acción (igual en las dos), qué partes del DOM comparar y qué capturar
const click = (sel, nth = 0) => async (p) => { await p.locator(sel).nth(nth).click(); };
const hoverAt = (sel, fx, fy) => async (p) => {
  const b = await p.locator(sel).first().boundingBox();
  await p.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
};
const esc = async (p) => { await p.keyboard.press('Escape'); };
// El portapapeles es uno para todo el navegador: las copias, de una en una
let clipChain = Promise.resolve();
const clipLock = (fn) => { const r = clipChain.then(fn); clipChain = r.catch(() => {}); return r; };
const MODAL = '.modal';
// Espera a que acabe el desplazamiento suave (scroll-behavior: smooth)
const scrollStill = async (p) => {
  let last = -1;
  for (let i = 0; i < 60; i++) { await p.waitForTimeout(100); const y = await p.evaluate(() => scrollY); if (y === last) return; last = y; }
};

function steps(kind, mobile) {
  const S = [];
  const add = (name, act, dom, shotTarget) => S.push({ name, act, dom, shot: shotTarget });
  add('carga inicial', null, ['body'], 'page');
  add('#ranking orden winrate', click('#sort button[data-sort=winrate]'), ['#ranking'], '#ranking');
  add('#ranking orden racha', click('#sort button[data-sort=streak]'), ['#ranking'], '#ranking');
  add('#ranking orden KDA', click('#sort button[data-sort=kda]'), ['#ranking'], '#ranking');
  add('#ranking orden LP periodo', click('#sort button[data-sort=period]'), ['#ranking'], '#ranking');
  add('#ranking periodo semana', click('#period button[data-period=week]'), ['#ranking'], '#ranking');
  add('#ranking periodo mes', click('#period button[data-period=month]'), ['#ranking'], '#ranking');
  add('#ranking periodo hoy', click('#period button[data-period=day]'), ['#ranking'], '#ranking');
  add('#ranking orden elo', click('#sort button[data-sort=rank]'), ['#ranking'], '#ranking');
  // (y se quita el foco: en el móvil el navegador mueve la página para enseñar el campo durante la captura)
  const search = (q) => async (p) => { await p.fill('#search', q); await p.locator('#search').evaluate((e) => e.blur()); };
  add('#ranking buscar "xp"', search('xp'), ['#ranking'], '#ranking');
  add('#ranking buscar sin resultados', search('zzzz'), ['#ranking'], '#ranking');
  add('#ranking buscar vacío', search(''), ['#ranking'], '#ranking');
  add('ficha: abrir 1º', click('#rows .row .tr', 0), ['#rows'], '#rows');
  add('ficha: abrir partida', click('#rows .row.open .match', 0), ['#rows'], '#rows .row.open');
  add('ficha: abrir 2ª partida', click('#rows .row.open .match', 1), ['#rows'], '#rows .row.open');
  add('ficha: cerrar partida', click('#rows .row.open .match', 0), ['#rows'], '#rows .row.open');
  add('ficha: pestaña stats', click('#rows .row.open .dtabs button', 1), ['#rows'], '#rows .row.open');
  add('ficha: elo 7 días', click('#rows .row.open .e-range button', 0), ['#rows'], '#rows .row.open');
  add('ficha: elo temporada', click('#rows .row.open .e-range button', 2), ['#rows'], '#rows .row.open');
  add('ficha: tooltip elo', hoverAt('#rows .row.open .echart svg', 0.6, 0.5), ['#rows .echart'], '#rows .row.open .echart');
  add('ficha: tooltip elo fuera', async (p) => { await p.mouse.move(2, 2); }, ['#rows .echart'], '#rows .row.open .echart');
  add('ficha: pestaña campeones', click('#rows .row.open .dtabs button', 2), ['#rows'], '#rows .row.open');
  add('ficha: pestaña historial', click('#rows .row.open .dtabs button', 0), ['#rows'], '#rows .row.open');
  add('ficha: abrir 2º jugador', click('#rows .row .tr', 1), ['#rows'], '#rows');
  if (kind === 'variante') {
    add('ficha: otra cuenta', async (p) => { await p.locator('#rows .row.open .dacc button').nth(1).click(); }, ['#rows'], '#rows');
    add('ficha: otra cuenta stats', async (p) => { await p.locator('#rows .row.open:has(.dacc) .dtabs button').nth(1).click(); }, ['#rows'], '#rows');
    add('ficha: jugador sin datos', async (p) => { await p.locator('#rows .row .tr', { hasText: 'Nuevo' }).click(); }, ['#rows'], '#rows');
    add('ficha: sin datos stats', async (p) => { await p.locator('#rows .row.open', { hasText: 'Nuevo' }).locator('.dtabs button').nth(1).click(); }, ['#rows'], '#rows');
    add('ficha: sin datos campeones', async (p) => { await p.locator('#rows .row.open', { hasText: 'Nuevo' }).locator('.dtabs button').nth(2).click(); }, ['#rows'], '#rows');
  }
  add('ficha: comparar desde ficha', click('#rows .row.open .dl-btn', 0), ['body'], 'viewport');
  add('comparador: cambiar A', async (p) => { await p.locator('.cmp-sel').nth(0).selectOption({ index: 3 }); }, [MODAL], `${MODAL} .modal-box`);
  add('comparador: cambiar B al de A', async (p) => { const v = await p.locator('.cmp-sel').nth(0).inputValue(); await p.locator('.cmp-sel').nth(1).selectOption(v); }, [MODAL], `${MODAL} .modal-box`);
  add('comparador: intercambiar', click('.cmp-swap'), [MODAL], `${MODAL} .modal-box`);
  add('comparador: copiar enlace', (p) => clipLock(async () => {
    await p.locator('.cmp-bar-top .ghost-btn').click();
    await p.waitForFunction(() => document.querySelector('.cmp-bar-top .ghost-btn')?.textContent === '¡Enlace copiado!');
    p.__link = await p.evaluate(() => navigator.clipboard.readText());
  }), [MODAL], null);
  add('comparador: cerrar con ×', click('.modal-x'), ['body'], 'viewport');
  add('ficha: cerrar todas', async (p) => { while (await p.locator('#rows .row.open .tr').count()) await p.locator('#rows .row.open .tr').first().click(); }, ['#rows'], '#rows');
  add('menú Más: abrir', click('#more-btn'), ['header'], 'viewport');
  add('menú Más: Escape', esc, ['header'], 'header');
  add('menú Más: instalar', async (p) => { await p.click('#more-btn'); await p.click('#more-menu [data-action=install]'); }, ['body'], 'viewport');
  add('menú Más: cerrar instalar', esc, ['body'], null);
  add('menú Más: comparar', async (p) => { await p.click('#more-btn'); await p.click('#more-menu [data-action=compare]'); }, ['body'], 'viewport');
  add('menú Más: cerrar comparar (clic fuera)', async (p) => { await p.mouse.click(5, 5); }, ['body'], null);
  add('menú Más: enlace Best 5', async (p) => { await p.click('#more-btn'); await p.click('#more-menu a[href="#best5"]'); await scrollStill(p); }, ['header'], 'viewport');
  add('novedades: abrir partida', click('#events button.ev', 0), [MODAL], 'viewport');
  add('novedades: cerrar', esc, ['body'], null);
  add('semana: pasada', click('#week-tabs button[data-week=last]'), ['#semana'], '#semana');
  add('semana: copiar resumen', (p) => clipLock(async () => {
    await p.locator('#week .wk-actions .ghost-btn').nth(0).click();
    await p.waitForFunction(() => document.querySelector('#week .wk-actions .ghost-btn')?.textContent === '¡Copiado!');
    p.__clip = await p.evaluate(() => navigator.clipboard.readText());
  }), ['#semana'], null);
  add('semana: abrir partida destacada', click('#week .wk-hl.click', 0), [MODAL], 'viewport');
  add('semana: cerrar partida', esc, ['body'], null);
  add('semana: historial', click('#week-tabs button[data-week=archive]'), ['#semana'], '#semana');
  add('semana: abrir semana del historial', click('#week .wk-card', 1), ['#semana'], '#semana');
  add('semana: volver al historial', click('#week .wk-back'), ['#semana'], '#semana');
  add('semana: esta semana', click('#week-tabs button[data-week=current]'), ['#semana'], '#semana');
  add('best5: por elo', click('#best5-toggle button[data-mode=elo]'), ['#best5'], '#best5');
  add('best5: por rendimiento', click('#best5-toggle button[data-mode=perf]'), ['#best5'], '#best5');
  add('best5: ventana de ayuda', click('#best5-info'), ['body'], 'viewport');
  add('best5: cerrar ayuda (fondo)', async (p) => { await p.mouse.click(3, 400); }, ['body'], null);
  add('evolución: 2 semanas', click('#ge-range button[data-days="14"]'), ['#evolucion'], '#evolucion');
  add('evolución: todo', click('#ge-range button[data-days="0"]'), ['#evolucion'], '#evolucion');
  // Tras pulsar, el ratón sigue encima del nombre (la antigua rehacía la leyenda y el navegador lo volvía a resaltar)
  add('evolución: ocultar uno', async (p) => { const c = p.locator('#ge-legend .ge-chip').nth(1); await c.click(); await c.hover({ position: { x: 6, y: 6 } }); }, ['#evolucion'], '#evolucion');
  add('evolución: resaltar (leyenda)', hoverAt('#ge-legend .ge-chip >> nth=2', 0.5, 0.5), ['#evolucion'], '#evolucion');
  add('evolución: tooltip', hoverAt('#ge-chart svg', 0.55, 0.5), ['#evolucion'], '#evolucion');
  add('evolución: tooltip fuera del rango', hoverAt('#ge-chart svg', 0.01, 0.5), ['#evolucion'], '#evolucion');
  add('evolución: salir', async (p) => { await p.mouse.move(2, 2); }, ['#evolucion'], '#evolucion');
  add('evolución: ninguno', click('#ge-none'), ['#evolucion'], '#evolucion');
  add('evolución: todos', click('#ge-all'), ['#evolucion'], '#evolucion');
  add('evolución: 1 mes', click('#ge-range button[data-days="30"]'), ['#evolucion'], '#evolucion');
  add('dúos: abrir partida', click('#duos-main .dg', 0), [MODAL], 'viewport');
  add('dúos: cerrar', esc, ['body'], null);
  add('dúos: comparar pareja', click('#duos-main .duo-cmp', 0), ['body'], 'viewport');
  add('dúos: cerrar comparar', esc, ['body'], null);
  if (kind === 'variante') {
    add('cara a cara: abrir partida', click('#rivals .dg', 0), [MODAL], 'viewport');
    add('cara a cara: cerrar', esc, ['body'], null);
    add('flex: abrir partida de Clash', click('#flex-box .fx-games >> nth=1 >> .fx-game', 0), [MODAL], 'viewport');
    add('flex: cerrar', esc, ['body'], null);
  }
  add('tilt: un jugador', click('#tilt-who button', 2), ['#tilt'], '#tilt');
  add('tilt: grupo', click('#tilt-who button', 0), ['#tilt'], '#tilt');
  add('campeones: ver todos', click('#champs-box .center .ghost-btn'), ['#campeones'], '#campeones');
  add('campeones: ver menos', click('#champs-box .center .ghost-btn'), ['#campeones'], '#campeones');
  add('días: bajones', click('#days-toggle button[data-mode=down]'), ['#dias'], '#dias');
  add('días: subidones', click('#days-toggle button[data-mode=up]'), ['#dias'], '#dias');
  add('premios: ver clasificación', click('#awards .aw-more', 0), ['#records'], '#awards');
  add('premios: ocultar', click('#awards .aw-more', 0), ['#records'], '#awards');
  add('récords: partida de un récord', click('#game-records .gr', 0), [MODAL], 'viewport');
  add('récords: cerrar', esc, ['body'], null);
  add('récords: racha/oro', click('#records-grid .rec.clickable', 0), [MODAL], 'viewport');
  add('récords: cerrar 2', esc, ['body'], null);
  add('aviso: cerrar', click('#banner .bn-x'), ['#banner', 'header'], null);
  add('recargar (mismos datos)', async (p) => { await p.click('#refresh'); await p.waitForTimeout(500); }, ['body'], null);
  return S;
}

// Pasos que cargan la página con un enlace directo
function routes() {
  const id = REAL.players[0].accounts[0].recent[0].id;
  return [
    { name: 'ruta #vs/xALOzZ/xPATQ', hash: '#vs/xALOzZ/xPATQ' },
    { name: 'ruta #vs con nombre codificado', hash: `#vs/${encodeURIComponent('El Desgracias v2')}/${encodeURIComponent('Teyeno tuniña')}` },
    { name: `ruta #partida/${id}`, hash: `#partida/${id}` },
    { name: 'ruta #partida sin detalle', hash: `#partida/${REAL.events.find((e) => e.gameId).gameId}` },
    { name: 'ancla #semana', hash: '#semana', anchor: 'semana' },
  ];
}

// Diferencias deliberadas: la web antigua pasa null a replaceChildren() en Flex y Campeones cuando falta una
// parte opcional, y el navegador lo pinta como el texto "null" (se ve "nullnull" al final de Flex). La nueva
// no lo pinta; aquí se quita ese texto de la antigua antes de comparar (DOM y captura).
const OLD_FIXES = () => {
  for (const id of ['flex-box', 'champs-box']) {
    for (const n of [...(document.getElementById(id)?.childNodes ?? [])]) if (n.nodeType === 3 && n.data === 'null') n.remove();
  }
};

async function compare(label, olds, news, dom, shotTarget) {
  await olds.page.evaluate(OLD_FIXES);
  const [a, b] = await Promise.all([olds.page.evaluate(serialize, dom), news.page.evaluate(serialize, dom)]);
  const [ya, yb] = await Promise.all([olds.page.evaluate(() => Math.round(scrollY)), news.page.evaluate(() => Math.round(scrollY))]);
  if (Math.abs(ya - yb) > 1) scrollNotes.push(`${label}: scroll ${ya} / ${yb}`);
  const domOk = a === b;
  const safe = label.replace(/[^\w.-]+/g, '_').slice(0, 90);
  if (!domOk) { writeFileSync(join(OUT, `${safe}.old.txt`), a); writeFileSync(join(OUT, `${safe}.new.txt`), b); }
  let px = { ratio: 0, note: '-' };
  if (shotTarget) {
    const [sa, sb] = await Promise.all([shot(olds, shotTarget), shot(news, shotTarget)]);
    px = pixelDiff(sa, sb, safe);
  }
  const ok = domOk && px.ratio <= PIXEL_MAX;
  results.push({ label, domOk, ratio: px.ratio, note: px.note, ok, diff: domOk ? '' : firstDiff(a, b) });
  process.stdout.write(`${ok ? 'OK  ' : 'FALLA'} ${label}${domOk ? '' : ' [DOM]'}${px.ratio > PIXEL_MAX ? ` [px ${px.ratio.toExponential(2)} ${px.note}]` : ''}\n`);
  return { a, b };
}

async function run(kind, width) {
  const dataDir = kind === 'real' ? join(REPO, 'data') : (() => {
    const dir = mkdtempSync(join(tmpdir(), 'soloq-parity-'));
    writeFileSync(join(dir, 'data.json'), JSON.stringify(variant()));
    return dir;
  })();
  const dataDirs = kind === 'real' ? [dataDir] : [dataDir, join(REPO, 'data')];
  const tag = `${kind} ${width}px`;
  try {
    // Recorrido con interacciones
    const olds = await side(kind, 'antes', width, REPO, dataDirs), news = await side(kind, 'ahora', width, DIST, dataDirs);
    await Promise.all([olds.page.goto(ORIGIN), news.page.goto(ORIGIN)]);
    await Promise.all([settle(olds), settle(news)]);
    for (const st of steps(kind, width < 600)) {
      if (ONLY && !st.name.includes(ONLY)) { try { if (st.act) await Promise.all([st.act(olds.page), st.act(news.page)]); } catch (e) { process.stdout.write(`(paso previo con error) ${st.name}: ${String(e).split('\n')[0]}\n`); } await Promise.all([settle(olds), settle(news)]); continue; }
      try {
        if (st.act) await Promise.all([st.act(olds.page), st.act(news.page)]);
        await Promise.all([settle(olds), settle(news)]);
        await compare(`${tag} · ${st.name}`, olds, news, st.dom, st.shot);
      } catch (e) {
        results.push({ label: `${tag} · ${st.name}`, domOk: false, ratio: 1, note: 'error', ok: false, diff: String(e).split('\n')[0] });
        process.stdout.write(`ERROR ${tag} · ${st.name}: ${String(e).split('\n')[0]}\n`);
      }
    }
    // Texto para WhatsApp (portapapeles) e imagen para compartir (descarga)
    if (!ONLY || 'compartir'.includes(ONLY)) {
      const [ta, tb] = [olds.page.__clip ?? '', news.page.__clip ?? ''];
      const textOk = ta === tb && ta.length > 50;
      results.push({ label: `${tag} · semana: texto para WhatsApp`, domOk: textOk, ratio: 0, note: `${ta.length} caracteres`, ok: textOk, diff: textOk ? '' : firstDiff(ta, tb) });
      process.stdout.write(`${textOk ? 'OK  ' : 'FALLA'} ${tag} · semana: texto para WhatsApp\n`);
      const down = async (s) => {
        await s.page.keyboard.press('Escape');
        await s.page.locator('#week-tabs button[data-week=current]').click();
        await settle(s);
        const [d] = await Promise.all([s.page.waitForEvent('download'), s.page.locator('#week .wk-actions .ghost-btn').nth(1).click()]);
        const p = join(OUT, `share-${kind}-${width}-${s.which}.png`);
        await d.saveAs(p);
        return { buf: readFileSync(p), name: d.suggestedFilename() };
      };
      const [ia, ib] = [await down(olds), await down(news)];
      const px = pixelDiff(ia.buf, ib.buf, `share-${kind}-${width}`);
      const ok = px.ratio <= PIXEL_MAX && ia.name === ib.name;
      results.push({ label: `${tag} · semana: imagen para compartir (${ia.name})`, domOk: ia.name === ib.name, ratio: px.ratio, note: px.note, ok, diff: '' });
      process.stdout.write(`${ok ? 'OK  ' : 'FALLA'} ${tag} · semana: imagen para compartir${px.ratio ? ` [px ${px.ratio}]` : ''}\n`);
    }
    // Vista de ordenador (solo en el móvil): recarga con el viewport de 1280 px que pone viewport.js
    if (width < 600 && (!ONLY || 'vista de ordenador'.includes(ONLY))) {
      // Antes de recargar, las dos arriba: si el navegador recupera o no la posición depende de cuándo llegue el contenido
      const act = async (p) => { await p.keyboard.press('Escape'); await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' })); await p.click('#more-btn'); await Promise.all([p.waitForEvent('load'), p.click('#desktop-btn')]); };
      await Promise.all([act(olds.page), act(news.page)]);
      await Promise.all([settle(olds), settle(news)]);
      await compare(`${tag} · vista de ordenador (recarga)`, olds, news, ['body'], 'page');
      const vp = await Promise.all([olds.page, news.page].map((p) => p.evaluate(() => document.querySelector('meta[name=viewport]').content + ' · ' + innerWidth)));
      const ok = vp[0] === vp[1] && vp[0].startsWith('width=1280');
      results.push({ label: `${tag} · vista de ordenador: viewport`, domOk: ok, ratio: 0, note: vp[1], ok, diff: ok ? '' : `${vp[0]} / ${vp[1]}` });
    }
    for (const s of [olds, news]) if (s.errors.length) results.push({ label: `${tag} · errores en consola (${s.which})`, domOk: false, ratio: 0, note: '', ok: false, diff: s.errors.slice(0, 3).join(' | ') });
    await olds.context.close(); await news.context.close();

    // Enlaces directos (página nueva cada vez)
    for (const r of routes()) {
      if (ONLY && !r.name.includes(ONLY)) continue;
      const o = await side(kind, 'antes', width, REPO, dataDirs), n = await side(kind, 'ahora', width, DIST, dataDirs);
      await Promise.all([o.page.goto(ORIGIN + r.hash), n.page.goto(ORIGIN + r.hash)]);
      await Promise.all([settle(o), settle(n)]);
      // Diferencia deliberada en las anclas: la antigua se queda a media altura (salta antes de que llegue el
      // contenido de arriba); la nueva va a la sección cuando ya está pintada. Se compara el DOM y dónde queda.
      await compare(`${tag} · ${r.name}`, o, n, r.anchor ? ['main', 'footer'] : ['body'], r.anchor ? null : 'viewport');
      if (r.anchor) {
        const top = (p) => p.evaluate((id) => Math.round(document.getElementById(id).getBoundingClientRect().top), r.anchor);
        const [ta, tb] = [await top(o.page), await top(n.page)];
        const ok = tb >= 0 && tb <= 100;
        results.push({ label: `${tag} · ${r.name}: la sección queda arriba (deliberado)`, domOk: ok, ratio: 0, note: `antes ${ta}px · ahora ${tb}px`, ok, diff: '' });
      }
      await o.context.close(); await n.context.close();
    }
  } finally {
    if (kind !== 'real') rmSync(dataDir, { recursive: true, force: true });
  }
}

// Sin conexión: con el service worker activo, una recarga sin red enseña los últimos datos (las dos versiones)
async function offline() {
  const dataDirs = [join(REPO, 'data')];
  for (const [which, root] of [['antes', REPO], ['ahora', DIST]]) {
    const srv = await serve(root, dataDirs);
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
    const page = await context.newPage();
    await page.route(/^https:\/\//, (r) => r.abort());
    let ok = false, note = '';
    try {
      await page.goto(srv.url);
      await page.waitForFunction(() => navigator.serviceWorker?.controller || null, null, { timeout: 15000 }).catch(() => null);
      if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }); }
      await page.waitForSelector('#rows .row', { timeout: 15000 });
      await page.waitForTimeout(500);
      await context.setOffline(true);
      await page.reload();
      await page.waitForSelector('#rows .row', { timeout: 15000 });
      const rows = await page.locator('#rows .row').count();
      ok = rows === REAL.players.length;
      note = `${rows} filas sin conexión`;
    } catch (e) { note = String(e).split('\n')[0]; }
    results.push({ label: `sin conexión (service worker) · ${which}`, domOk: ok, ratio: 0, note, ok, diff: '' });
    process.stdout.write(`${ok ? 'OK  ' : 'FALLA'} sin conexión · ${which}: ${note}\n`);
    await context.close(); srv.srv.close();
  }
}

for (const kind of ['real', 'variante']) for (const w of [1366, 390]) await run(kind, w);
if (!ONLY || 'sin conexión'.includes(ONLY)) await offline();
await browser.close();

// ---------------------------------------------------------------- tabla
const pad = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
console.log(`\n${pad('Comprobación', 78)} ${pad('DOM', 5)} ${pad('Píxeles distintos', 18)} Resultado`);
console.log('-'.repeat(118));
for (const r of results) {
  console.log(`${pad(r.label, 78)} ${pad(r.domOk ? 'igual' : 'DIF', 5)} ${pad(r.note === '-' ? '-' : `${(r.ratio * 100).toFixed(4)} %`, 18)} ${r.ok ? 'OK' : 'FALLA'}${r.ratio > 0 && r.ok ? ' (suavizado)' : ''}`);
  if (r.diff) console.log(`    ${r.diff}`);
}
if (scrollNotes.length) console.log(`\nPosición de scroll distinta tras el paso (antes / ahora):\n  ${scrollNotes.join('\n  ')}`);
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} comprobaciones correctas${bad.length ? ` · ${bad.length} fallan (detalles en web/tests/out)` : ''}`);
process.exit(bad.length ? 1 : 0);

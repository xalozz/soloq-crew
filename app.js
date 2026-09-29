'use strict';

// ---------------------------------------------------------------- constantes
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const TIER_ES = {
  IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Aspirante',
};
const DIVS = ['IV', 'III', 'II', 'I'];
const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
const ROLE_ES = { TOP: 'Top', JUNGLE: 'Jungla', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
const ROLE_ICON = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'middle', BOTTOM: 'bottom', UTILITY: 'utility' };
const LINK_LABELS = { opgg: 'OP.GG', ugg: 'U.GG', dpm: 'DPM.LOL', log: 'LeagueOfGraphs' };
const CDRAGON = 'https://raw.communitydragon.org/latest/plugins';
const TZ = 'Europe/Madrid';

let DATA = null;
let sortKey = 'rank';
let query = '';
let daysMode = 'up';
const expanded = new Set();

// ---------------------------------------------------------------- utilidades
function h(tag, attrs, ...children) {
  const el = document.createElementNS(
    ['svg', 'path', 'polyline', 'line', 'circle', 'title'].includes(tag) && attrs?.svg ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml',
    tag,
  );
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false || k === 'svg') continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
const svg = (tag, attrs, ...kids) => h(tag, { ...attrs, svg: true }, ...kids);

const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? '–' : Number(n).toFixed(d).replace(/\.0+$/, ''));
const fmtInt = (n) => (n == null ? '–' : Number(n).toLocaleString('es-ES'));
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (t) => dayFmt.format(new Date(t));
const prettyDay = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function timeAgo(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const hrs = Math.round(min / 60);
  return hrs < 48 ? `hace ${hrs} h` : `hace ${Math.round(hrs / 24)} días`;
}

// ---------------------------------------------------------------- rangos
function rankScore(rank) {
  if (!rank?.tier) return -1;
  if (APEX.has(rank.tier)) return 2800 + rank.lp;
  return TIERS.indexOf(rank.tier) * 400 + DIVS.indexOf(rank.division) * 100 + rank.lp;
}
function rankName(rank) {
  if (!rank) return 'Sin clasificar';
  const n = TIER_ES[rank.tier] ?? rank.tier;
  return APEX.has(rank.tier) ? n : `${n} ${rank.division}`;
}
// Para puntos antiguos del historial solo tenemos la puntuación.
function scoreLabel(score) {
  if (score >= 2800) return `Maestro+ · ${score - 2800} LP`;
  const t = Math.floor(score / 400), d = Math.floor((score % 400) / 100);
  return `${TIER_ES[TIERS[t]]} ${DIVS[d]} · ${score % 100} LP`;
}
const tierKey = (rank) => (rank?.tier ? rank.tier.toLowerCase() : 'unranked');

// ---------------------------------------------------------------- historial de LP
// lpHist = [[timestamp, score], ...] ordenado; un punto por cada cambio de elo.
function startOfDayScore(hist, today = dayKey(Date.now())) {
  if (!hist?.length) return null;
  let base = null;
  for (const [t, s] of hist) {
    if (dayKey(t) < today) base = s;
    else break;
  }
  if (base == null) {
    const first = hist.find(([t]) => dayKey(t) === today);
    base = first ? first[1] : null;
  }
  return base;
}
function dailyDeltas(hist) {
  const out = [];
  if (!hist?.length) return out;
  const byDay = new Map();
  for (const [t, s] of hist) byDay.set(dayKey(t), s); // último valor de cada día
  const days = [...byDay.keys()].sort();
  for (let i = 1; i < days.length; i++) {
    out.push({ day: days[i], delta: byDay.get(days[i]) - byDay.get(days[i - 1]), end: byDay.get(days[i]) });
  }
  return out;
}

// ---------------------------------------------------------------- modelo
function buildModel(raw) {
  const players = raw.players.map((p) => {
    const main = p.accounts[p.bestAccount] ?? p.accounts[0];
    const s = main?.stats ?? null;
    const rank = main?.rank ?? null;
    const score = rankScore(rank);
    const base = startOfDayScore(main?.lpHist);
    const totalW = p.accounts.reduce((n, a) => n + (a.rank?.wins ?? 0), 0);
    const totalL = p.accounts.reduce((n, a) => n + (a.rank?.losses ?? 0), 0);
    return {
      ...p, main, s, rank, score,
      baseScore: base,
      today: base != null && score >= 0 ? score - base : null,
      wins: rank?.wins ?? 0, losses: rank?.losses ?? 0,
      winrate: rank ? rank.winrate : -1,
      totalGames: totalW + totalL,
      streakVal: s?.streak?.current?.count ? (s.streak.current.type === 'W' ? 1 : -1) * s.streak.current.count : 0,
    };
  });
  // Posición por elo y cambio respecto al inicio del día
  const byScore = [...players].sort((a, b) => b.score - a.score);
  byScore.forEach((p, i) => { p.pos = i + 1; });
  const withBase = players.filter((p) => p.baseScore != null);
  if (withBase.length >= 2) {
    [...withBase].sort((a, b) => b.baseScore - a.baseScore).forEach((p, i) => { p.posDelta = i + 1 - p.pos; });
  }
  return players;
}

const SORTERS = {
  rank: (a, b) => b.score - a.score,
  today: (a, b) => (b.today ?? -1e9) - (a.today ?? -1e9),
  winrate: (a, b) => b.winrate - a.winrate,
  streak: (a, b) => b.streakVal - a.streakVal,
  kda: (a, b) => (b.s?.kda ?? -1) - (a.s?.kda ?? -1),
};

// ---------------------------------------------------------------- piezas visuales
function avatar(p, size = 40, cls = '') {
  const icon = p.main?.profileIconId;
  const fallback = () => h('span', { class: `avatar ph ${cls}`, style: `width:${size}px;height:${size}px` }, (p.name || '?').slice(0, 1).toUpperCase());
  if (!icon || !DATA.ddragonVersion) return fallback();
  return h('img', {
    class: `avatar ${cls}`, width: size, height: size, alt: '', loading: 'lazy',
    src: `https://ddragon.leagueoflegends.com/cdn/${DATA.ddragonVersion}/img/profileicon/${icon}.png`,
    onerror: (e) => e.target.replaceWith(fallback()),
  });
}

function champIcon(champ, size = 26) {
  const ph = () => h('span', { class: 'champ ph', style: `width:${size}px;height:${size}px`, title: champ || '' });
  if (!champ || !DATA.ddragonVersion) return ph();
  return h('img', {
    class: 'champ', width: size, height: size, loading: 'lazy', alt: champ, title: champ,
    src: `https://ddragon.leagueoflegends.com/cdn/${DATA.ddragonVersion}/img/champion/${encodeURIComponent(champ)}.png`,
    onerror: (e) => e.target.replaceWith(ph()),
  });
}

function crest(rank, size = 30) {
  const key = tierKey(rank);
  if (key === 'unranked') return h('span', { class: 'crest ph', style: `width:${size}px;height:${size}px` });
  return h('img', {
    class: 'crest', width: size, height: size, alt: '', loading: 'lazy',
    src: `${CDRAGON}/rcp-fe-lol-shared-components/global/default/${key}.png`,
    onerror: (e) => e.target.replaceWith(h('span', { class: 'crest ph', style: `width:${size}px;height:${size}px` })),
  });
}

function roleIcon(role) {
  if (!role || !ROLE_ICON[role]) return h('span', { class: 'muted' }, '–');
  return h('img', {
    class: 'role-ico', width: 22, height: 22, alt: ROLE_ES[role], title: ROLE_ES[role], loading: 'lazy',
    src: `${CDRAGON}/rcp-fe-lol-static-assets/global/default/svg/position-${ROLE_ICON[role]}.svg`,
  });
}

function medal(pos) {
  if (pos === 1) {
    return svg('svg', { class: 'medal gold', viewBox: '0 0 24 24', 'aria-label': 'Primero' },
      svg('path', { d: 'M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5z' }));
  }
  return h('span', { class: `medal-num m${pos}` }, pos);
}

function winBar(w, l) {
  const n = w + l;
  if (!n) return h('span', { class: 'muted' }, 'Sin partidas');
  const wr = (w / n) * 100;
  return h('div', { class: 'wbar', title: `${w} victorias · ${l} derrotas` },
    h('div', { class: 'wbar-top' },
      h('b', { class: wr >= 50 ? 'pos' : 'neg' }, `${fmt(wr)}%`),
      h('span', { class: 'w' }, `${w}V`), h('span', { class: 'l' }, `${l}D`)),
    h('div', { class: 'wbar-track' },
      h('i', { class: 'seg-w', style: `width:${wr}%` }),
      h('i', { class: 'seg-l', style: `width:${100 - wr}%` })));
}

// Línea acumulada de victorias(+1)/derrotas(-1) de las últimas 20 partidas.
function sparkline(trend, w = 96, hgt = 28) {
  if (!trend?.length) return h('span', { class: 'muted' }, '–');
  let acc = 0;
  const pts = [0, ...trend.map((x) => (acc += x ? 1 : -1))];
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = Math.max(1, max - min);
  const step = w / (pts.length - 1);
  const coords = pts.map((v, i) => `${(i * step).toFixed(1)},${(2 + (hgt - 4) * (1 - (v - min) / span)).toFixed(1)}`).join(' ');
  const wins = trend.filter(Boolean).length;
  const up = acc >= 0;
  return svg('svg', { class: `spark ${up ? 'up' : 'down'}`, viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, role: 'img', 'aria-label': `Últimas ${trend.length}: ${wins}V ${trend.length - wins}D` },
    svg('title', {}, `Últimas ${trend.length}: ${wins}V ${trend.length - wins}D`),
    svg('polyline', { points: coords, fill: 'none', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
}

function streakChip(s) {
  const c = s?.streak?.current;
  if (!c?.count) return h('span', { class: 'muted' }, '–');
  const win = c.type === 'W';
  return h('span', { class: `chip ${win ? 'chip-w' : 'chip-l'}`, title: win ? 'Victorias seguidas' : 'Derrotas seguidas' }, `${c.count}${win ? 'V' : 'D'}`);
}

function todayCell(v) {
  if (v == null) return h('span', { class: 'muted' }, '–');
  if (v === 0) return h('span', { class: 'muted' }, '0');
  return h('b', { class: v > 0 ? 'pos' : 'neg' }, `${v > 0 ? '▲' : '▼'} ${Math.abs(v)}`);
}

function tierTag(rank) {
  return h('span', { class: `tier-tag t-${tierKey(rank)}` }, rankName(rank));
}

// ---------------------------------------------------------------- podio
function podiumCard(p) {
  const s = p.s;
  const r = p.rank;
  const l20 = s?.last20;
  return h('article', { class: `pod pod-${p.pos}` },
    h('div', { class: 'pod-top' },
      medal(p.pos),
      avatar(p, 44),
      h('div', { class: 'pod-id' }, h('b', {}, p.name), h('span', {}, `${p.main.gameName}#${p.main.tagLine}`)),
      roleIcon(s?.mainRole)),
    h('div', { class: 'pod-mid' },
      crest(r, 76),
      h('div', { class: 'pod-elo' },
        h('span', { class: `pod-tier t-${tierKey(r)}` }, rankName(r)),
        h('b', { class: 'pod-lp' }, r ? fmtInt(r.lp) : '–', h('small', {}, 'LP')))),
    h('div', { class: 'pod-stats' },
      h('div', {}, h('b', {}, `${p.wins}V ${p.losses}D`), h('span', {}, `${p.wins + p.losses} partidas`)),
      h('div', {}, h('b', {}, r ? `${fmt(r.winrate, 0)}%` : '–'), h('span', {}, 'Winrate')),
      h('div', {}, h('b', {}, l20 ? `${l20.wins}V ${l20.losses}D` : '–'), h('span', {}, `Últimas ${l20?.games ?? 20}`))),
    h('div', { class: 'pod-bar' }, h('i', { style: `width:${r ? r.winrate : 0}%` })));
}

// ---------------------------------------------------------------- tabla
function row(p, idx) {
  const s = p.s;
  const open = expanded.has(p.name);
  const byElo = sortKey === 'rank';
  const shownPos = byElo ? p.pos : idx + 1;
  const delta = byElo && p.posDelta ? h('small', { class: p.posDelta > 0 ? 'pos' : 'neg' }, `${p.posDelta > 0 ? '▲' : '▼'}${Math.abs(p.posDelta)}`) : null;

  const head = h('button', {
    class: 'tr', 'aria-expanded': open,
    onclick: () => { open ? expanded.delete(p.name) : expanded.add(p.name); renderRows(); },
  },
    h('span', { class: 'c-pos' }, byElo && shownPos <= 3 ? medal(shownPos) : h('b', { class: 'num' }, shownPos), delta),
    h('span', { class: 'c-player' },
      avatar(p, 38),
      h('span', { class: 'who' },
        h('b', {}, p.name),
        h('span', {}, `${p.main.gameName}#${p.main.tagLine}`, p.accounts.length > 1 ? ` · +${p.accounts.length - 1}` : ''))),
    h('span', { class: 'c-role' }, roleIcon(s?.mainRole)),
    h('span', { class: 'c-elo' }, crest(p.rank, 30),
      h('span', { class: 'elo-txt' }, h('b', { class: `t-${tierKey(p.rank)}` }, rankName(p.rank)), p.rank ? h('small', {}, `${p.rank.lp} LP`) : null)),
    h('span', { class: 'c-wr' }, winBar(p.wins, p.losses)),
    h('span', { class: 'c-trend' }, sparkline(s?.trend)),
    h('span', { class: 'c-streak' }, streakChip(s)),
    h('span', { class: 'c-today' }, todayCell(p.today)),
    h('span', { class: 'c-kda' }, h('b', {}, s ? fmt(s.kda, 2) : '–')),
    h('span', { class: 'c-chev', 'aria-hidden': 'true' }, open ? '−' : '+'));

  return h('div', { class: `row ${open ? 'open' : ''} ${byElo && shownPos <= 3 ? `top top${shownPos}` : ''}`, role: 'row' },
    head,
    open ? h('div', { class: 'detail' },
      p.links?.length ? h('div', { class: 'links' }, p.links.map((l) => h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label))) : null,
      h('div', { class: 'accs' }, p.accounts.map((a, i) => accountCard(a, p, p.accounts.length > 1 && i === p.bestAccount)))) : null);
}

function statCell(label, value, sub) {
  return h('div', { class: 'st' }, h('span', { class: 'st-l' }, label), h('b', { class: 'st-v' }, value), sub ? h('span', { class: 'st-s' }, sub) : null);
}
function bwLine(label, g, kind) {
  if (!g) return h('div', { class: 'bw' }, h('span', { class: 'bw-l' }, label), h('span', { class: 'muted' }, 'Pocos datos'));
  const name = kind === 'role' ? ROLE_ES[g.key] ?? g.key : g.key;
  return h('div', { class: 'bw' }, h('span', { class: 'bw-l' }, label),
    kind === 'champ' ? champIcon(g.key, 22) : roleIcon(g.key),
    h('b', {}, name), h('span', { class: 'muted' }, `${fmt(g.winrate)}% · ${g.games} part. · KDA ${fmt(g.kda, 2)}`));
}
function gameLine(label, g) {
  if (!g) return null;
  return h('div', { class: 'bw' }, h('span', { class: 'bw-l' }, label), champIcon(g.champ, 22),
    h('b', {}, `${g.k}/${g.d}/${g.a}`), h('span', { class: 'muted' }, `${g.win ? 'Victoria' : 'Derrota'} · KDA ${fmt(g.kda, 2)}`));
}

function accountCard(acc, p, isMain) {
  const s = acc.stats;
  return h('div', { class: 'acc' },
    h('div', { class: 'acc-head' },
      crest(acc.rank, 44),
      h('div', { class: 'acc-id' },
        h('b', {}, acc.gameName, h('span', { class: 'muted' }, `#${acc.tagLine}`)),
        h('span', { class: 'muted small' }, [acc.label, isMain ? 'Cuenta principal' : null, acc.level ? `Nivel ${acc.level}` : null, (acc.region || '').toUpperCase()].filter(Boolean).join(' · '))),
      h('div', { class: 'acc-rank' }, tierTag(acc.rank), acc.rank ? h('b', {}, `${acc.rank.lp} LP`) : null)),
    acc.error ? h('p', { class: 'err' }, `No se pudo actualizar: ${acc.error}`) : null,
    acc.rank ? winBar(acc.rank.wins, acc.rank.losses) : null,
    s ? h('div', { class: 'st-grid' },
      statCell('Racha actual', streakChip(s)),
      statCell('Mejor racha', `${s.streak.bestWin}V`),
      statCell('Peor racha', `${s.streak.worstLoss}D`),
      statCell('KDA', fmt(s.kda, 2), `${fmt(s.avgK)} / ${fmt(s.avgD)} / ${fmt(s.avgA)}`),
      statCell('CS/min', fmt(s.csPerMin)),
      statCell('Visión/min', fmt(s.visPerMin, 2)),
      statCell('% daño', s.dmgShare == null ? '–' : `${fmt(s.dmgShare)}%`),
      statCell('Últimas 20', `${fmt(s.last20.winrate)}%`, sparkline(s.trend, 80, 20)),
      statCell('Muestra', `${s.games}`, 'partidas analizadas'))
      : h('p', { class: 'muted' }, 'Sin partidas de SoloQ guardadas todavía.'),
    s ? h('div', { class: 'bw-list' },
      bwLine('Mejor campeón', s.bestChamp, 'champ'), bwLine('Peor campeón', s.worstChamp, 'champ'),
      bwLine('Mejor rol', s.bestRole, 'role'), bwLine('Peor rol', s.worstRole, 'role'),
      gameLine('Mejor partida', s.bestGame), gameLine('Peor partida', s.worstGame)) : null,
    s?.topChamps?.length ? h('div', { class: 'tops' }, h('span', { class: 'bw-l' }, 'Más jugados'),
      s.topChamps.map((c) => h('span', { class: 'tc', title: `${c.key}: ${c.games} partidas, ${fmt(c.winrate)}% WR` }, champIcon(c.key, 28), h('small', {}, `${c.games}`)))) : null,
    h('div', { class: 'links' }, Object.entries(acc.links || {}).map(([k, url]) =>
      h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, LINK_LABELS[k] ?? k))));
}

// ---------------------------------------------------------------- estadísticas
const STAT_CARDS = [
  { title: 'Kills', sub: 'Más asesinatos por partida', get: (s) => s.avgK, d: 1 },
  { title: 'Muertes', sub: 'Más veces eliminado por partida', get: (s) => s.avgD, d: 1 },
  { title: 'Asistencias', sub: 'Más asistencias por partida', get: (s) => s.avgA, d: 1 },
  { title: 'CS/min', sub: 'Farmeo por minuto', get: (s) => s.csPerMin, d: 1 },
  { title: 'Visión', sub: 'Puntuación de visión por minuto', get: (s) => s.visPerMin, d: 2 },
  { title: '% daño', sub: 'Parte del daño a campeones de su equipo', get: (s) => s.dmgShare, d: 1, suffix: '%' },
];

function statCard(def, players) {
  const list = players.filter((p) => p.s && def.get(p.s) != null)
    .map((p) => ({ p, v: def.get(p.s) }))
    .sort((a, b) => b.v - a.v);
  if (!list.length) return null;
  const [first, ...rest] = list;
  const val = (v) => `${fmt(v, def.d)}${def.suffix ?? ''}`;
  return h('article', { class: 'scard' },
    h('h3', { class: 'card-title' }, def.title),
    h('p', { class: 'card-sub' }, def.sub),
    h('div', { class: 'leader' },
      h('span', { class: 'leader-pos' }, '1'),
      h('div', { class: 'leader-who' }, avatar(first.p, 76, 'big'), h('b', {}, first.p.name), tierTag(first.p.rank)),
      h('div', { class: 'leader-val' }, h('b', {}, val(first.v)), h('span', {}, `${first.p.s.games} partidas`))),
    h('ol', { class: 'lb', start: 2 }, rest.map((x, i) =>
      h('li', { class: `lb-row t-border-${tierKey(x.p.rank)}` },
        h('span', { class: 'lb-pos' }, i + 2), avatar(x.p, 26), h('span', { class: 'lb-name' }, x.p.name),
        h('b', { class: 'lb-val' }, val(x.v)), h('span', { class: 'lb-games' }, `${x.p.s.games} partidas`)))));
}

function kdaCard(players) {
  const list = players.filter((p) => p.s).sort((a, b) => b.s.kda - a.s.kda).slice(0, 4);
  if (!list.length) return null;
  return h('article', { class: 'scard wide' },
    h('h3', { class: 'card-title' }, 'KDA'),
    h('p', { class: 'card-sub' }, 'Kills + asistencias / muertes'),
    h('div', { class: 'kda-row' }, list.map((p, i) =>
      h('div', { class: 'kda-item' },
        h('span', { class: 'leader-pos' }, i + 1),
        h('div', { class: 'leader-who' }, avatar(p, 64, 'big'), h('b', {}, p.name), tierTag(p.rank)),
        h('div', { class: 'leader-val' }, h('b', {}, fmt(p.s.kda, 2)), h('span', {}, `${p.s.games} partidas`))))));
}

// ---------------------------------------------------------------- días
function renderDays(players) {
  const all = [];
  for (const p of players) for (const d of dailyDeltas(p.main?.lpHist)) if (d.delta) all.push({ p, ...d });
  const list = (daysMode === 'up'
    ? all.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta)
    : all.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta)).slice(0, 8);
  const box = document.getElementById('days-list');
  if (!list.length) {
    box.replaceChildren(h('p', { class: 'empty' },
      'Todavía no hay días completos registrados. El LP se guarda en cada actualización, así que esta tabla se irá llenando a partir de mañana.'));
    return;
  }
  box.replaceChildren(...list.map((d, i) => h('div', { class: 'day-row' },
    h('span', { class: 'lb-pos' }, i + 1), avatar(d.p, 32),
    h('div', { class: 'who' }, h('b', {}, d.p.name), h('span', {}, `${prettyDay(d.day)} · ${scoreLabel(d.end)}`)),
    h('b', { class: `day-val ${d.delta > 0 ? 'pos' : 'neg'}` }, `${signed(d.delta)}`))));
}

// ---------------------------------------------------------------- récords
function renderRecords(players) {
  const rows = players.filter((p) => p.s);
  const pick = (items, val, dir = 1) => (items.length ? items.reduce((m, x) => (dir * (val(x) - val(m)) > 0 ? x : m)) : null);
  const W = rows.filter((r) => r.s.streak.current.type === 'W' && r.s.streak.current.count);
  const L = rows.filter((r) => r.s.streak.current.type === 'L' && r.s.streak.current.count);
  const elig = rows.filter((r) => r.rank && r.wins + r.losses >= 30);
  const champs = [];
  for (const p of rows) for (const c of p.s.topChamps ?? []) if (c.games >= 5) champs.push({ p, c });

  const defs = [
    ['Racha de victorias activa', pick(W, (r) => r.s.streak.current.count), (r) => `${r.s.streak.current.count} seguidas`, 'good'],
    ['Racha de derrotas activa', pick(L, (r) => r.s.streak.current.count), (r) => `${r.s.streak.current.count} seguidas`, 'bad'],
    ['Mejor racha registrada', pick(rows, (r) => r.s.streak.bestWin), (r) => `${r.s.streak.bestWin} victorias`, 'good'],
    ['Peor racha registrada', pick(rows, (r) => r.s.streak.worstLoss), (r) => `${r.s.streak.worstLoss} derrotas`, 'bad'],
    ['Mejor winrate de temporada', pick(elig, (r) => r.rank.winrate), (r) => `${fmt(r.rank.winrate)}%`, 'good'],
    ['Peor winrate de temporada', pick(elig, (r) => r.rank.winrate, -1), (r) => `${fmt(r.rank.winrate)}%`, 'bad'],
    ['Mejor partida', pick(rows, (r) => r.s.bestGame.kda), (r) => `${r.s.bestGame.champ} ${r.s.bestGame.k}/${r.s.bestGame.d}/${r.s.bestGame.a}`, 'good', (r) => r.s.bestGame.champ],
    ['Peor partida', pick(rows, (r) => r.s.worstGame.kda, -1), (r) => `${r.s.worstGame.champ} ${r.s.worstGame.k}/${r.s.worstGame.d}/${r.s.worstGame.a}`, 'bad', (r) => r.s.worstGame.champ],
    ['Mejor campeón (5+ partidas)', pick(champs, (x) => x.c.winrate * 1000 + x.c.games), (x) => `${x.c.key} ${fmt(x.c.winrate, 0)}%`, 'good', (x) => x.c.key],
    ['Más partidas en temporada', pick(rows.filter((r) => r.rank), (r) => r.wins + r.losses), (r) => `${fmtInt(r.wins + r.losses)} partidas`, 'neutral'],
  ];
  const cards = defs.filter((d) => d[1]).map(([title, r, fmtFn, tone, champFn]) => {
    const p = r.p && r.c ? r.p : r;
    return h('div', { class: `rec rec-${tone}` },
      h('span', { class: 'rec-t' }, title),
      h('div', { class: 'rec-main' }, champFn ? champIcon(champFn(r), 34) : avatar(p, 34), h('b', { class: 'rec-v' }, fmtFn(r))),
      h('span', { class: 'rec-w' }, p.name));
  });
  document.getElementById('records-grid').replaceChildren(...cards);
}

// ---------------------------------------------------------------- render
let MODEL = [];

function renderRows() {
  const q = query.trim().toLowerCase();
  const list = [...MODEL].sort(SORTERS[sortKey])
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.accounts.some((a) => a.riotId.toLowerCase().includes(q)));
  const box = document.getElementById('rows');
  box.replaceChildren(...(list.length ? list.map(row) : [h('p', { class: 'empty' }, 'Ningún jugador coincide con la búsqueda.')]));
}

function renderMeta() {
  const ago = timeAgo(DATA.generatedAt);
  document.getElementById('updated').textContent = `Actualizado ${ago}`;
  document.getElementById('meta-updated').textContent = ago.replace('hace ', '');
  const games = MODEL.reduce((n, p) => n + p.totalGames, 0);
  const wins = MODEL.reduce((n, p) => n + p.accounts.reduce((m, a) => m + (a.rank?.wins ?? 0), 0), 0);
  document.getElementById('meta-games').textContent = fmtInt(games);
  document.getElementById('meta-wr').textContent = games ? `${fmt((wins / games) * 100)}%` : '–';
}

function render() {
  document.title = DATA.title || 'SoloQ Crew';
  MODEL = buildModel(DATA);
  renderMeta();
  const top = [...MODEL].sort(SORTERS.rank).slice(0, 3);
  document.getElementById('podium').replaceChildren(...top.map(podiumCard));
  renderRows();
  document.getElementById('stats').replaceChildren(
    ...STAT_CARDS.map((d) => statCard(d, MODEL)).filter(Boolean), kdaCard(MODEL) ?? '');
  renderDays(MODEL);
  renderRecords(MODEL);
}

function wire() {
  document.getElementById('sort').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-sort]');
    if (!b) return;
    sortKey = b.dataset.sort;
    for (const x of e.currentTarget.children) x.classList.toggle('on', x === b);
    renderRows();
  });
  document.getElementById('search').addEventListener('input', (e) => { query = e.target.value; renderRows(); });
  document.getElementById('days-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    daysMode = b.dataset.mode;
    for (const x of e.currentTarget.children) x.classList.toggle('on', x === b);
    renderDays(MODEL);
  });
  // Enlace activo del menú según la sección visible
  const links = [...document.querySelectorAll('.nav-links a')];
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${en.target.id}`));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('main section[id]').forEach((s) => io.observe(s));
  setInterval(() => DATA && renderMeta(), 60_000);
}

async function init() {
  wire();
  try {
    const res = await fetch(`data/data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    DATA = await res.json();
  } catch {
    document.getElementById('rows').replaceChildren(h('p', { class: 'empty' }, 'Todavía no hay datos. Aparecerán tras la primera actualización automática.'));
    return;
  }
  render();
}

init();

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
let period = 'day';          // columna de LP del ranking: hoy, semana o mes
let STATUS = null;           // resultado de la última pasada del actualizador (viaja en el latido)
let LIVE = [];               // partidas en curso de los del grupo
const expanded = new Set();
const SITE_URL = 'https://xalozz.github.io/soloq-crew/';

// ---------------------------------------------------------------- utilidades
function h(tag, attrs, ...children) {
  const el = document.createElementNS(attrs?.svg ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag);
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
// Enlace externo que siempre abre en pestaña nueva (algunos navegadores integrados ignoran target=_blank)
const extLink = (url, label, cls) => h('a', {
  href: url, target: '_blank', rel: 'noopener noreferrer', class: cls,
  onclick: (e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; e.preventDefault(); window.open(url, '_blank', 'noopener'); },
}, label);

const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? '–' : Number(n).toFixed(d).replace(/\.0+$/, ''));
const fmtInt = (n) => (n == null ? '–' : Number(n).toLocaleString('es-ES'));
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const goldK = (v, sign = true) => (v == null ? '–' : `${sign ? (v > 0 ? '+' : v < 0 ? '−' : '') : ''}${(Math.abs(v) / 1000).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`);

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (t) => dayFmt.format(new Date(t));
const prettyDay = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Inicio de día, semana (lunes) y mes en hora de Madrid
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
function madridParts(t) {
  const p = {};
  for (const x of partsFmt.formatToParts(new Date(t))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second, wd: WD[p.weekday] ?? 0 };
}
function madridMidnight(y, m, d) {
  const off = (t) => { const p = madridParts(t); return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(t / 1000) * 1000; };
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - off(guess);
  t = guess - off(t);
  return t;
}
const dayStartMs = (t) => { const p = madridParts(t); return madridMidnight(p.y, p.m, p.d); };
const weekStartMs = (t) => { const p = madridParts(t); return madridMidnight(p.y, p.m, p.d - p.wd); };
const monthStartMs = (t) => { const p = madridParts(t); return madridMidnight(p.y, p.m, 1); };
function weekKeyOf(t) {
  const p = madridParts(t);
  const date = new Date(Date.UTC(p.y, p.m - 1, p.d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
function rangeLabel(from, toExcl) {
  const a = madridParts(from), b = madridParts(toExcl - 1);
  return a.m === b.m ? `${a.d}–${b.d} ${MONTHS_ES[b.m - 1]}` : `${a.d} ${MONTHS_ES[a.m - 1]} – ${b.d} ${MONTHS_ES[b.m - 1]}`;
}
const pct = (w, n) => (n ? (w / n) * 100 : 0);
const plural = (n, one, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;

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
// Elo al empezar un periodo: el último punto anterior o, si no hay, el primero del periodo.
function scoreAtStart(hist, t0) {
  if (!hist?.length) return null;
  let base = null;
  for (const [t, s] of hist) {
    if (t < t0) base = s;
    else break;
  }
  if (base == null) {
    const first = hist.find(([t]) => t >= t0);
    base = first ? first[1] : null;
  }
  return base;
}
const startOfDayScore = (hist) => scoreAtStart(hist, dayStartMs(Date.now()));
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

// LP, partidas y puesto de cada uno en el periodo elegido (hoy, semana o mes) y en el anterior
const PERIODS = {
  day: { short: 'hoy', this: 'hoy', prev: 'ayer', start: dayStartMs },
  week: { short: 'semana', this: 'esta semana', prev: 'la semana pasada', start: weekStartMs },
  month: { short: 'mes', this: 'este mes', prev: 'el mes pasado', start: monthStartMs },
};
function gamesBetween(acc, from, to = Infinity) {
  const seq = acc?.seq ?? (acc?.recent ?? []).map((g) => [g.t, g.win ? 1 : 0]);
  return seq.filter(([t]) => t >= from && t < to);
}
function applyPeriod(players) {
  const P = PERIODS[period];
  const start = P.start(Date.now()), prevStart = P.start(start - 1);
  for (const p of players) {
    const hist = p.main?.lpHist;
    const base = scoreAtStart(hist, start), prevBase = scoreAtStart(hist, prevStart);
    const g = gamesBetween(p.main, start), gp = gamesBetween(p.main, prevStart, start);
    const wins = g.filter((x) => x[1]).length;
    p.per = { lp: base != null && p.score >= 0 ? p.score - base : null, games: g.length, wins, losses: g.length - wins };
    p.perPrev = { lp: base != null && prevBase != null ? base - prevBase : null, games: gp.length };
  }
  const order = (key) => (a, b) => (b[key].lp ?? -1e9) - (a[key].lp ?? -1e9) || b.score - a.score;
  const now = players.filter((p) => p.per.games).sort(order('per'));
  const before = players.filter((p) => p.perPrev.games).sort(order('perPrev'));
  for (const p of players) { p.perPos = null; p.perDelta = null; }
  now.forEach((p, i) => {
    p.perPos = i + 1;
    const j = before.indexOf(p);
    p.perDelta = j >= 0 ? j - i : null;
  });
}

const SORTERS = {
  rank: (a, b) => b.score - a.score,
  period: (a, b) => (b.per.games ? 1 : 0) - (a.per.games ? 1 : 0) || (b.per.lp ?? -1e9) - (a.per.lp ?? -1e9) || b.score - a.score,
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

function periodCell(p) {
  const P = PERIODS[period];
  const { lp: v, games, wins, losses } = p.per;
  if (!games) return h('span', { class: 'today-none', title: `No ha jugado ${P.this}` }, '–');
  const n = h('small', { class: 'today-n' }, `${wins}V ${losses}D`);
  if (v == null) return h('span', { class: 'today-wrap' }, h('span', { class: 'muted' }, '?'), n);
  if (v === 0) return h('span', { class: 'today-wrap', title: 'Ha ganado y perdido los mismos LP' }, h('b', { class: 'today-zero' }, '0'), n);
  return h('span', { class: 'today-wrap', title: `${signed(v)} LP ${P.this} · ${games} partidas` }, h('b', { class: v > 0 ? 'pos' : 'neg' }, `${v > 0 ? '▲' : '▼'} ${Math.abs(v)}`), n);
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
function posDeltaTag(d, title) {
  if (!d) return null;
  return h('small', { class: d > 0 ? 'pos' : 'neg', title }, `${d > 0 ? '▲' : '▼'}${Math.abs(d)}`);
}

// Segunda línea bajo el nombre: partida en curso, aviso de tilt o su Riot ID
function whoLine(p) {
  const live = liveOf(p.name);
  if (live) {
    const mates = live.g.p.filter((x) => x.n !== p.name);
    const withTxt = mates.length ? ` · ${mates.some((x) => x.tm != null && x.tm !== live.me.tm) ? 'contra' : 'con'} ${mates.map((x) => x.n).join(', ')}` : '';
    return h('span', { class: 'who-live', title: `${QUEUE_ES[live.g.q] ?? 'Partida'} en curso${withTxt}` },
      h('i', { class: 'live-dot' }), live.me.c ? champIcon(live.me.c, 16) : null,
      h('span', {}, `${QUEUE_ES[live.g.q] ?? 'En partida'} · `, liveMinutes(live.g.s), withTxt));
  }
  return h('span', {}, `${p.main.gameName}#${p.main.tagLine}`, p.accounts.length > 1 ? ` · +${p.accounts.length - 1}` : '');
}

function row(p, idx) {
  const s = p.s;
  const open = expanded.has(p.name);
  const byElo = sortKey === 'rank';
  const byPeriod = sortKey === 'period';
  const shownPos = byElo ? p.pos : idx + 1;
  const delta = byElo ? posDeltaTag(p.posDelta, 'Puestos respecto a esta mañana')
    : byPeriod && p.per.games ? posDeltaTag(p.perDelta, `Puestos respecto a ${PERIODS[period].prev}`) : null;
  const tilt = tiltNow(p);

  const head = h('button', {
    class: 'tr', 'aria-expanded': open,
    onclick: () => { open ? expanded.delete(p.name) : expanded.add(p.name); renderRows(); },
  },
    h('span', { class: 'c-pos' }, byElo && shownPos <= 3 ? medal(shownPos) : h('b', { class: 'num' }, shownPos), delta),
    h('span', { class: 'c-player' },
      avatar(p, 38),
      h('span', { class: 'who' },
        h('b', {}, p.name, tilt ? h('span', { class: 'tilt-flag', title: tilt }, ' 🧊') : null),
        whoLine(p))),
    h('span', { class: 'c-role' }, roleIcon(s?.mainRole)),
    h('span', { class: 'c-elo' }, crest(p.rank, 30),
      h('span', { class: 'elo-txt' }, h('b', { class: `t-${tierKey(p.rank)}` }, rankName(p.rank)), p.rank ? h('small', {}, `${p.rank.lp} LP`) : null)),
    h('span', { class: 'c-wr' }, winBar(p.wins, p.losses)),
    h('span', { class: 'c-trend' }, sparkline(s?.trend)),
    h('span', { class: 'c-streak' }, streakChip(s)),
    h('span', { class: 'c-today' }, periodCell(p)),
    h('span', { class: 'c-kda' }, h('b', {}, s ? fmt(s.kda, 2) : '–')),
    h('span', { class: 'c-chev', 'aria-hidden': 'true' }, open ? '−' : '+'));

  return h('div', { class: `row ${open ? 'open' : ''} ${byElo && shownPos <= 3 ? `top top${shownPos}` : ''} ${byPeriod && !p.per.games ? 'idle' : ''} ${liveOf(p.name) ? 'is-live' : ''}`, role: 'row' },
    head,
    open ? playerDetail(p) : null);
}

// ---------------------------------------------------------------- ficha de jugador
const detailTab = new Map();  // jugador → pestaña
const detailAcc = new Map();  // jugador → índice de cuenta
const DD = () => `https://ddragon.leagueoflegends.com/cdn/${DATA.ddragonVersion}`;

function ddImg(url, size, cls, title) {
  if (!url || !DATA.ddragonVersion) return h('span', { class: `ico ph ${cls || ''}`, style: `width:${size}px;height:${size}px` });
  return h('img', {
    class: `ico ${cls || ''}`, width: size, height: size, loading: 'lazy', alt: title || '', title: title || '', src: url,
    onerror: (e) => e.target.replaceWith(h('span', { class: `ico ph ${cls || ''}`, style: `width:${size}px;height:${size}px` })),
  });
}
const spellImg = (key, size = 18) => (key ? ddImg(`${DD()}/img/spell/${key}.png`, size, 'spell', key.replace('Summoner', '')) : ddImg(null, size, 'spell'));
const runeImg = (path, size = 18, cls = 'rune') => (path ? ddImg(`https://ddragon.leagueoflegends.com/cdn/img/${path}`, size, cls) : ddImg(null, size, cls));
const itemImg = (id, size = 26) => (id ? ddImg(`${DD()}/img/item/${id}.png`, size, 'item') : h('span', { class: 'ico item empty', style: `width:${size}px;height:${size}px` }));

function loadoutBlock(l, size) {
  if (!l) return null;
  return h('div', { class: 'loadout' },
    h('span', { class: 'lo-champ' }, champIcon(l.champ, size)),
    h('span', { class: 'lo-col' }, spellImg(l.spells?.[0], Math.round(size / 2.2)), spellImg(l.spells?.[1], Math.round(size / 2.2))),
    h('span', { class: 'lo-col' }, runeImg(l.runes?.[0], Math.round(size / 2.2), 'rune key'), runeImg(l.runes?.[1], Math.round(size / 3), 'rune sec')));
}

const ago = (t) => timeAgo(new Date(t).toISOString());
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function lpBadge(lp) {
  if (!lp) return h('span', { class: 'm-lp muted', title: 'Partida anterior al registro de LP' }, '— LP');
  const txt = `${lp.d > 0 ? '+' : ''}${lp.d} LP`;
  if (lp.n > 1) return h('span', { class: `m-lp ${lp.d >= 0 ? 'pos' : 'neg'}`, title: `Cambio conjunto de ${lp.n} partidas jugadas seguidas entre dos actualizaciones` }, txt, h('small', {}, `${lp.n} part.`));
  return h('span', { class: `m-lp ${lp.d >= 0 ? 'pos' : 'neg'}` }, txt);
}

// ---------------------------------------------------------------- detalle de partida (10 jugadores)
const openMatches = new Set();
const detailCache = new Map(); // id → datos | null (no disponible)
const REGION_LOG = { EUW1: 'euw', EUN1: 'eune', NA1: 'na', KR: 'kr', BR1: 'br', LA1: 'lan', LA2: 'las', OC1: 'oce', TR1: 'tr', RU: 'ru', JP1: 'jp' };
const logUrl = (id) => { const [r, n] = id.split('_'); return `https://www.leagueofgraphs.com/match/${REGION_LOG[r] ?? 'euw'}/${n}`; };
const friendIds = () => new Set((DATA?.players ?? []).flatMap((p) => p.accounts.map((a) => a.riotId.toLowerCase())));

// Nombre de jugador enlazado a su perfil de OP.GG (pestaña nueva)
function opggName(rid, matchId) {
  const i = (rid || '').lastIndexOf('#');
  if (i < 1) return h('b', { title: rid }, rid);
  const region = REGION_LOG[(matchId || '').split('_')[0]] ?? 'euw';
  const url = `https://op.gg/lol/summoners/${region}/${encodeURIComponent(rid.slice(0, i))}-${encodeURIComponent(rid.slice(i + 1))}`;
  const a = extLink(url, rid, 'md-link');
  a.title = `Ver ${rid} en OP.GG`;
  a.addEventListener('click', (e) => e.stopPropagation());
  return h('b', {}, a);
}

async function loadDetail(id) {
  if (detailCache.has(id)) return detailCache.get(id);
  try {
    const r = await fetch(`data/matches/${encodeURIComponent(id)}.json?t=${Math.floor(Date.now() / 6e5)}`);
    const d = r.ok ? await r.json() : null;
    detailCache.set(id, d);
    return d;
  } catch { return null; }
}

function matchDetailView(id, meRiotId) {
  const box = h('div', { class: 'md' }, h('p', { class: 'md-loading' }, 'Cargando partida…'));
  loadDetail(id).then((d) => {
    if (!d) {
      box.replaceChildren(h('p', { class: 'empty' }, 'Detalle no disponible: solo se guardan las últimas 20 partidas de cada uno y las de los récords.'),
        h('div', { class: 'md-foot' }, extLink(logUrl(id), 'Ver en LeagueOfGraphs ↗')));
      return;
    }
    const friends = friendIds();
    const me = (meRiotId || '').toLowerCase();
    box.replaceChildren(
      h('div', { class: 'md-teams' }, d.teams.map((t) => h('div', { class: `md-team ${t.teamId === 100 ? 'side-blue' : 'side-red'}` },
        h('div', { class: 'md-head' },
          h('b', { class: 'md-side' }, t.teamId === 100 ? 'Lado azul' : 'Lado rojo'),
          h('span', { class: t.win ? 'pos' : 'neg' }, t.win ? 'Victoria' : 'Derrota'),
          h('span', { class: 'muted' }, `${t.kills} kills · ${goldK(t.gold, false)} oro`),
          t.bans?.length ? h('span', { class: 'md-bans' }, h('small', {}, 'Bans'), t.bans.map((c) => champIcon(c, 18))) : null),
        t.players.map((p) => {
          const rid = (p.rid || '').toLowerCase();
          const kda = (p.k + p.a) / Math.max(1, p.d);
          return h('div', { class: `md-p ${rid === me ? 'me' : friends.has(rid) ? 'friend' : ''}` },
            h('div', { class: 'md-lo' }, loadoutBlock(p, 32), p.lvl ? h('span', { class: 'md-lvl' }, p.lvl) : null),
            h('div', { class: 'md-name' }, opggName(p.rid, id), h('span', {}, h('span', {}, p.k), ' / ', h('span', { class: 'neg' }, p.d), ' / ', h('span', {}, p.a),
              h('small', {}, ` · ${p.d ? fmt(kda, 1) : 'Perfect'} KDA`))),
            h('div', { class: 'md-num' }, h('b', {}, p.cs), h('small', {}, 'CS')),
            h('div', { class: 'md-num' }, h('b', {}, goldK(p.dmg, false)), h('small', {}, 'daño')),
            h('div', { class: 'm-items md-items' }, (p.items ?? []).map((it, i) => itemImg(it, i === 6 ? 20 : 22))));
        })))),
      h('div', { class: 'md-foot' }, h('span', { class: 'muted' }, `${mmss(d.dur)} · ${new Date(d.t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ })}`),
        extLink(logUrl(id), 'Ver en LeagueOfGraphs ↗')));
  });
  return box;
}

// Ventana genérica (detalle de partida, explicaciones, comparador…). Devuelve la función para cerrarla.
function openModal(title, content, { wide = false, onClose, head } = {}) {
  const close = () => {
    ov.remove();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('modal-open');
    // Si se abrió desde un enlace (#partida/… o #vs/…), al cerrar se limpia la dirección
    if (/^#(partida|vs)\//.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'modal', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: `modal-box ${wide ? '' : 'narrow'}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, head ?? h('b', {}, title), h('button', { class: 'modal-x', onclick: close, 'aria-label': 'Cerrar' }, '×')),
      content));
  document.addEventListener('keydown', onKey);
  document.body.classList.add('modal-open');
  document.body.append(ov);
  return close;
}

function best5Info() {
  const P = (...c) => h('p', {}, ...c);
  openModal('Cómo se calcula el Best 5', h('div', { class: 'info-body' },
    h('h4', {}, 'Por rendimiento'),
    P('Cada jugador recibe una puntuación en cada rol con su ', h('b', {}, 'winrate ajustado'), ':'),
    h('div', { class: 'formula' }, '(victorias + 10) / (partidas + 20)'),
    P('Es como si todos empezaran con 10 victorias y 10 derrotas "fantasma": con muchas partidas casi no cambia nada, con pocas se acerca al 50 %. Así 5 de 5 no gana a 60 de 100.'),
    P(h('b', {}, 'Ejemplo: '), '41 victorias en 75 partidas (54,7 %) → 51 / 95 = 53,7 %.'),
    h('h4', {}, 'Quién puede ir a cada rol'),
    P('Solo los roles que el jugador juega de verdad: mínimo 10 partidas en ese rol y al menos el 20 % de todas las suyas.'),
    h('h4', {}, 'Cómo se forma el quinteto'),
    P('Se prueban todas las combinaciones posibles sin repetir jugador y gana la que ', h('b', {}, 'más suma entre los cinco roles'), '. Por eso alguien puede salir en su segundo mejor rol si así el equipo entero sale mejor.'),
    h('h4', {}, 'El campeón de cada casilla'),
    P('Su mejor campeón en ese rol (mínimo 3 partidas) con un ajuste más suave: (victorias + 2) / (partidas + 4).'),
    P(h('b', {}, 'Pick con mejor winrate: '), 'el mejor campeón del grupo en ese rol, lo juegue quien lo juegue (mínimo 10 partidas, misma fórmula). Puede no coincidir con el jugador elegido: un jugador puede tener un gran campeón pero peor media en el rol.'),
    h('h4', {}, 'Por elo'),
    P('Mismas condiciones para entrar en un rol, pero puntúa el rango de cada jugador en lugar del winrate.'),
    P(h('span', { class: 'muted' }, 'Datos: partidas de SoloQ de la temporada de la cuenta principal de cada uno.'))));
}

// Ventana con el detalle de una partida (récords, novedades, dúos…)
function openMatchModal(id, title, meRiotId) {
  return openModal(title, matchDetailView(id, meRiotId), { wide: true });
}

function matchRow(g, acc) {
  const kda = (g.k + g.a) / Math.max(1, g.d);
  const perfect = g.d === 0;
  const open = openMatches.has(g.id);
  const toggle = () => {
    if (openMatches.has(g.id)) openMatches.delete(g.id); else openMatches.add(g.id);
    const fresh = matchRow(g, acc);
    wrap.replaceWith(fresh);
  };
  const row = h('div', {
    class: `match ${g.win ? 'win' : 'loss'} ${open ? 'open' : ''}`, role: 'button', tabindex: 0, 'aria-expanded': open,
    onclick: toggle, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } },
  },
    h('div', { class: 'm-res' }, h('b', {}, g.win ? 'Victoria' : 'Derrota'), h('span', {}, `${mmss(g.dur)} · ${ago(g.t)}`)),
    h('span', { class: 'm-role' }, roleIcon(g.role)),
    h('div', { class: 'm-me' }, g.spells ? loadoutBlock(g, 40) : champIcon(g.champ, 40)),
    g.opp ? h('div', { class: 'm-vs' }, h('small', {}, 'vs'), loadoutBlock(g.opp, 30)) : h('div', { class: 'm-vs' }),
    h('div', { class: 'm-kda' },
      h('b', {}, h('span', {}, g.k), ' / ', h('span', { class: 'neg' }, g.d), ' / ', h('span', {}, g.a)),
      h('span', {}, [perfect ? 'Perfect' : `${fmt(kda, 1)} KDA`, g.kp != null ? `${g.kp}% KP` : null, `${g.cs} CS`].filter(Boolean).join(' · ')),
      g.gold ? h('span', { class: 'm-gold', title: `Ventaja máx. del equipo ${goldK(g.gold.maxLead)} · desventaja máx. ${goldK(g.gold.maxDef)}` },
        g.gold.gd15 != null ? h('span', { class: g.gold.gd15 >= 0 ? 'pos' : 'neg' }, `${goldK(g.gold.gd15)} oro @15`) : null,
        !g.win && g.gold.maxLead >= 3000 ? h('span', { class: 'throw-tag' }, `THROW ${goldK(g.gold.maxLead)}`) : null,
        g.win && g.gold.maxDef <= -3000 ? h('span', { class: 'comeback-tag' }, `REMONTADA ${goldK(g.gold.maxDef)}`) : null) : null),
    h('div', { class: 'm-items' }, (g.items ?? []).map((id, i) => itemImg(id, i === 6 ? 24 : 26))),
    lpBadge(g.lp),
    h('span', { class: 'm-chev', 'aria-hidden': 'true' }, open ? '▴' : '▾'));
  const wrap = h('div', { class: `mwrap ${g.win ? 'win' : 'loss'} ${open ? 'open' : ''}` }, row, open ? matchDetailView(g.id, acc?.riotId) : null);
  return wrap;
}

function tabHistorial(acc) {
  const games = acc.recent ?? [];
  if (!games.length) return h('p', { class: 'empty' }, 'Sin partidas de SoloQ registradas todavía.');
  return h('div', { class: 'matches' }, games.map((g) => matchRow(g, acc)));
}

function tile(label, value, cls = '') {
  return h('div', { class: `tile ${cls}` }, h('b', {}, value), h('span', {}, label));
}

function nextDivision(rank) {
  if (!rank || APEX.has(rank.tier)) return null;
  const d = DIVS.indexOf(rank.division);
  if (d < 3) return `${TIER_ES[rank.tier]} ${DIVS[d + 1]}`;
  const t = TIERS.indexOf(rank.tier);
  return t + 1 < 7 ? `${TIER_ES[TIERS[t + 1]]} IV` : 'Maestro';
}

// Serie de elo: tramo registrado (lpHist) + tramo reconstruido hacia atrás con el resultado de cada partida.
function eloSeries(acc) {
  const real = (acc.lpHist ?? []).map(([t, v]) => [t, v]);
  const lp = acc.stats?.lp;
  const W = lp?.win ?? 25, L = Math.abs(lp?.loss ?? -25);
  const T0 = real.length ? real[0][0] : Date.now();
  let sc = real.length ? real[0][1] : rankScore(acc.rank);
  const est = [];
  if (sc >= 0) {
    const before = (acc.seq ?? []).filter((g) => g[0] < T0).sort((x, y) => y[0] - x[0]);
    if (before.length) est.push([T0, sc]);
    for (const [t, win, d] of before) {
      est.push([t, sc]);
      sc = Math.max(0, sc - (d ?? (win ? W : -L)));
    }
    if (before.length) est.push([before.at(-1)[0] - 30 * 60e3, sc]);
    est.reverse();
  }
  return { est, real, W, L, measured: !!(lp?.winN || lp?.lossN) };
}

const TIER_HEX = ['#8a7f79', '#c07f4c', '#a9b8c6', '#e8b949', '#45c8b6', '#35d08e', '#74a9ff', '#b77cf2'];
const tierHex = (score) => TIER_HEX[Math.min(7, Math.max(0, Math.floor(score / 400)))];
const ELO_RANGES = [[7, '7 días'], [30, '30 días'], [0, 'Temporada']];
const eloRange = new Map(); // cuenta → días
let eloGradId = 0;

// Puntos [t, score, estimado] de toda la curva, uno por partida (o cambio de LP registrado)
function eloPoints({ est, real }) {
  const pts = [...est.map((p) => [p[0], p[1], true]), ...real.map((p) => [p[0], p[1], false])]
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, arr) => i === 0 || p[1] !== arr[i - 1][1] || p[2] !== arr[i - 1][2]);
  if (pts.length === 1) pts.push([Date.now(), pts[0][1], false]);
  return pts;
}

// Cambio de LP desde hace `days` días (el valor de antes de esa fecha como punto de partida)
function eloDelta(pts, days) {
  if (pts.length < 2) return null;
  const from = Date.now() - days * 864e5;
  const before = pts.filter((p) => p[0] <= from).at(-1) ?? pts[0];
  return pts.at(-1)[1] - before[1];
}

function eloChart(acc) {
  const box = h('div', { class: 'chart echart' });
  const ser = eloSeries(acc);
  const all = eloPoints(ser);
  if (all.length < 2) {
    box.append(h('p', { class: 'empty' }, 'Todavía no hay partidas suficientes para dibujar la evolución.'));
    return box;
  }
  const key = acc.riotId;
  const deltaChip = (days, label) => {
    const d = eloDelta(all, days);
    if (d == null) return null;
    return h('span', { class: 'e-delta' }, h('small', {}, label),
      h('b', { class: d > 0 ? 'pos' : d < 0 ? 'neg' : '' }, `${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d)} LP`));
  };
  const peak = all.reduce((m, p) => (p[1] > m[1] ? p : m));
  const body = h('div', { class: 'echart-body' });
  const draw = () => {
    const days = eloRange.get(key) ?? 30;
    const from = days ? Date.now() - days * 864e5 : -Infinity;
    let pts = all.filter((p) => p[0] >= from);
    const prev = all.filter((p) => p[0] < from).at(-1);
    if (prev) pts = [[from, prev[1], prev[2]], ...pts];
    if (pts.length < 2) pts = [[from, all.at(-1)[1], false], [Date.now(), all.at(-1)[1], false]];
    for (const b of tabs.querySelectorAll('button')) b.classList.toggle('on', Number(b.dataset.days) === days);
    drawEloChart(body, pts, ser);
  };
  const tabs = h('div', { class: 'toggle e-range' }, ELO_RANGES.map(([d, l]) =>
    h('button', { 'data-days': d, onclick: () => { eloRange.set(key, d); draw(); } }, l)));
  box.append(
    h('div', { class: 'echart-top' }, deltaChip(30, 'Últimos 30 días'), deltaChip(7, 'Últimos 7 días'), tabs),
    body,
    h('div', { class: 'echart-foot' },
      h('span', {}, h('small', {}, 'Pico'), h('b', { style: `color:${tierHex(peak[1])}` }, scoreLabel(peak[1])),
        h('small', { class: 'muted' }, ` · ${new Date(peak[0]).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: TZ })}${peak[2] ? ' (estimado)' : ''}`)),
      h('span', {}, h('small', {}, 'Ahora'), h('b', { style: `color:${tierHex(all.at(-1)[1])}` }, scoreLabel(all.at(-1)[1])))));
  requestAnimationFrame(draw);
  return box;
}

// Curva suave que no se pasa de los puntos (monotone cubic)
function smoothPath(P) {
  if (P.length < 3) return P.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const n = P.length, dx = [], m = [], tg = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0] || 1e-6; m[i] = (P[i + 1][1] - P[i][1]) / dx[i]; }
  tg[0] = m[0]; tg[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) tg[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h3 = dx[i] / 3;
    d += `C${(P[i][0] + h3).toFixed(1)},${(P[i][1] + tg[i] * h3).toFixed(1)} ${(P[i + 1][0] - h3).toFixed(1)},${(P[i + 1][1] - tg[i + 1] * h3).toFixed(1)} ${P[i + 1][0].toFixed(1)},${P[i + 1][1].toFixed(1)}`;
  }
  return d;
}

function drawEloChart(box, pts, { W, L, measured }) {
  const Wd = Math.max(300, box.clientWidth), H = 250, Lm = 40, R = 12, T = 16, B = 24;
  const n = pts.length;
  let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
  const pad = Math.max(20, (hi - lo) * 0.12);
  lo = Math.max(0, lo - pad); hi = hi + pad;
  const x = (i) => Lm + (i / Math.max(1, n - 1)) * (Wd - Lm - R);
  const y = (v) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const els = [];
  const id = `eg${++eloGradId}`;

  // Degradado vertical: cada tramo de la curva toma el color de su liga
  const stops = [];
  const top = y(hi), bot = y(lo);
  const at = (v) => Math.min(1, Math.max(0, (y(v) - top) / Math.max(1, bot - top)));
  for (let t = Math.min(7, Math.floor(hi / 400)); t >= Math.max(0, Math.floor(lo / 400)); t--) {
    const upper = t === 7 ? hi : (t + 1) * 400, lower = t * 400;
    stops.push(svg('stop', { offset: at(Math.min(hi, upper)), 'stop-color': TIER_HEX[t] }));
    stops.push(svg('stop', { offset: at(Math.max(lo, lower)), 'stop-color': TIER_HEX[t] }));
  }
  els.push(svg('defs', {},
    svg('linearGradient', { id: `${id}l`, gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: top, y2: bot }, ...stops),
    svg('linearGradient', { id: `${id}f`, x1: 0, x2: 0, y1: 0, y2: 1 },
      svg('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.22 }), svg('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 0 })),
    svg('mask', { id: `${id}m` }, svg('rect', { x: 0, y: 0, width: Wd, height: H, fill: `url(#${id}f)` }))));

  // Líneas de división (discontinuas) y de liga con su emblema
  const span = hi - lo;
  const step = span > 1200 ? 400 : 100;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const tierLine = v % 400 === 0 && v <= 2800;
    els.push(svg('line', { x1: Lm, x2: Wd - R, y1: y(v), y2: y(v), class: tierLine ? 'grid tier' : 'grid div' }));
    if (v > 2800) {
      els.push(svg('text', { x: Lm - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, `${v - 2800}`));
    } else if (tierLine || step === 100) {
      const t = Math.floor(v / 400);
      if (tierLine) {
        els.push(svg('image', { href: `${CDRAGON}/rcp-fe-lol-shared-components/global/default/${TIERS[t].toLowerCase()}.png`, x: Lm - 34, y: y(v) - 13, width: 26, height: 26 }));
      } else {
        els.push(svg('text', { x: Lm - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, DIVS[Math.floor((v % 400) / 100)]));
      }
    }
  }
  // Fechas
  const nTicks = Math.max(2, Math.min(6, Math.floor((Wd - Lm) / 110)));
  const seen = new Set();
  for (let k = 0; k < nTicks; k++) {
    const i = Math.round(((n - 1) * k) / (nTicks - 1));
    const key = dayKey(pts[i][0]);
    if (seen.has(key)) continue;
    seen.add(key);
    els.push(svg('text', { x: x(i), y: H - 6, class: 'axis', 'text-anchor': k === 0 ? 'start' : k === nTicks - 1 ? 'end' : 'middle' }, prettyDay(key)));
  }

  const P = pts.map((p, i) => [x(i), y(p[1])]);
  const curve = smoothPath(P);
  els.push(svg('path', { d: `${curve}L${P.at(-1)[0].toFixed(1)},${bot}L${P[0][0].toFixed(1)},${bot}Z`, fill: `url(#${id}l)`, mask: `url(#${id}m)` }));
  // Tramo estimado algo apagado y discontinuo; tramo registrado sólido
  const lastEst = pts.map((p) => p[2]).lastIndexOf(true);
  if (lastEst >= 0) {
    const e = Math.min(n - 1, lastEst + 1);
    els.push(svg('path', { d: smoothPath(P.slice(0, e + 1)), class: 'eline est', style: `stroke:url(#${id}l)` }));
    if (e < n - 1) els.push(svg('path', { d: smoothPath(P.slice(e)), class: 'eline', style: `stroke:url(#${id}l)` }));
  } else els.push(svg('path', { d: curve, class: 'eline', style: `stroke:url(#${id}l)` }));
  els.push(svg('circle', { cx: P.at(-1)[0], cy: P.at(-1)[1], r: 3.5, fill: tierHex(pts.at(-1)[1]) }));

  const dot = svg('circle', { r: 5, class: 'edot', cx: -20, cy: -20 });
  const cross = svg('line', { class: 'ecross', y1: T, y2: H - B, x1: -20, x2: -20 });
  const chart = svg('svg', { viewBox: `0 0 ${Wd} ${H}`, width: Wd, height: H, role: 'img', 'aria-label': 'Evolución del elo' }, ...els, cross, dot);
  const tip = h('div', { class: 'etip', hidden: true });
  chart.addEventListener('pointermove', (e) => {
    const r = chart.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * Wd;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - Lm) / (Wd - Lm - R)) * (n - 1))));
    const p = pts[i];
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p[1]));
    dot.style.fill = tierHex(p[1]);
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    tip.hidden = false;
    tip.replaceChildren(
      h('b', { style: `color:${tierHex(p[1])}` }, `${p[2] ? '≈ ' : ''}${scoreLabel(p[1])}`),
      h('span', {}, new Date(p[0]).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ })),
      ...(p[2] ? [h('small', {}, 'estimado')] : []));
    tip.style.left = `${(x(i) / Wd) * 100}%`;
    tip.style.top = `${(y(p[1]) / H) * 100}%`;
  });
  chart.addEventListener('pointerleave', () => { tip.hidden = true; dot.setAttribute('cx', -20); cross.setAttribute('x1', -20); cross.setAttribute('x2', -20); });
  const legend = h('div', { class: 'elegend' },
    lastEst >= 0 ? h('span', {}, h('i', { class: 'lg est' }), `Estimado (≈ +${W} / −${L} LP por partida${measured ? ', medidos' : ''})`) : null,
    h('span', {}, h('i', { class: 'lg' }), 'LP registrado'),
    h('span', { class: 'lg-note' }, `${n} puntos · uno por partida`));
  box.replaceChildren(chart, tip, legend);
}

function tabStats(acc) {
  const s = acc.stats, r = acc.rank;
  const next = nextDivision(r);
  const peak = acc.lpHist?.length ? Math.max(...acc.lpHist.map((x) => x[1])) : rankScore(r);
  const lp = s?.lp;
  const season = r ? r.wins + r.losses : null;
  const wr = r && season ? (r.wins / season) * 100 : null;
  const kv = (label, value, cls) => h('div', { class: 'kv' }, h('span', {}, label), h('b', { class: cls || '' }, value ?? '–'));
  const group = (title, ...rows) => h('div', { class: 'sg' }, h('h5', {}, title), ...rows);
  const signCls = (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');

  // Franja superior: rango · winrate · progreso de división
  const head = h('div', { class: 'sx-head', style: `--tc: var(--t-${tierKey(r)})` },
    h('div', { class: 'sxh-rank' }, crest(r, 46),
      h('div', {}, h('b', { class: `t-${tierKey(r)}` }, rankName(r)), h('span', {}, r ? `${r.lp} LP` : 'Sin clasificar'))),
    r ? h('div', { class: 'sxh-col' },
      h('div', { class: 'sxh-top' }, h('span', {}, 'Winrate'), h('b', { class: wr >= 50 ? 'pos' : 'neg' }, `${fmt(wr, 1)}%`),
        h('small', {}, h('span', { class: 'pos' }, `${r.wins}V`), ' ', h('span', { class: 'neg' }, `${r.losses}D`))),
      h('div', { class: 'thin split' }, h('i', { class: 'w', style: `width:${wr}%` }), h('i', { class: 'l', style: `width:${100 - wr}%` }))) : null,
    next ? h('div', { class: 'sxh-col' },
      h('div', { class: 'sxh-top' }, h('span', {}, `Hacia ${next}`), h('b', {}, `${r.lp}`), h('small', {}, '/ 100 LP')),
      h('div', { class: 'thin' }, h('i', { class: 'acc', style: `width:${Math.min(100, r.lp)}%` })))
      : r ? h('div', { class: 'sxh-col' }, h('div', { class: 'sxh-top' }, h('span', {}, 'Liga'), h('b', {}, `${r.lp} LP`))) : null);

  if (!s) return h('div', { class: 'sx' }, head, h('p', { class: 'empty' }, 'Sin partidas de SoloQ registradas todavía.'), h('h4', { class: 'sx-h' }, 'Evolución de elo'), eloChart(acc));

  // KDA destacado
  const kdaBox = h('div', { class: 'sx-kda2' },
    h('span', { class: 'lbl' }, 'KDA'),
    h('b', { class: 'big' }, fmt(s.kda, 2)),
    h('div', { class: 'kda-line' }, h('span', { class: 'pos' }, fmt(s.avgK)), ' / ', h('span', { class: 'neg' }, fmt(s.avgD)), ' / ', h('span', { class: 'blue' }, fmt(s.avgA)),
      h('small', {}, ' por partida')),
    s.totals ? h('div', { class: 'kda-tot' }, `${fmtInt(s.totals.k)} / ${fmtInt(s.totals.d)} / ${fmtInt(s.totals.a)} en total`) : null,
    h('div', { class: 'kda-games' }, h('b', {}, fmtInt(s.games)), ` partidas analizadas${season && season > s.games ? ` de ${fmtInt(season)}` : ''}`));

  const groups = h('div', { class: 'sgrid' },
    group('Combate',
      kv('KP media', s.avgKp != null ? `${s.avgKp}%` : null),
      kv('Récord de kills', s.maxKills),
      kv('First bloods', s.firstBloods),
      kv('Pentakills', s.pentas)),
    group('Farmeo y visión',
      kv('CS / min', fmt(s.csPerMin)),
      kv('Daño / min', s.dmgPerMin != null ? fmtInt(s.dmgPerMin) : null),
      kv('% daño equipo', s.dmgShare != null ? `${fmt(s.dmgShare)}%` : null),
      kv('Visión / partida', fmt(s.avgVision ?? null))),
    group('Oro',
      kv('Oro @15 vs rival', s.gold ? goldK(s.gold.avgGd15) : null, signCls(s.gold?.avgGd15)),
      kv('Mayor ventaja', s.gold?.biggestLead ? goldK(s.gold.biggestLead.val) : null, 'pos'),
      kv('Mayor throw', s.gold?.biggestThrow ? goldK(s.gold.biggestThrow.val, false) : null, 'neg'),
      kv('Partidas lanzadas', s.gold ? `${s.gold.throws}` : null)),
    group('Rachas y LP',
      kv('Racha actual', streakChip(s)),
      kv('1ª partida del día', s.firstOfDay ? h('span', { title: `${s.firstOfDay.wins}V en ${s.firstOfDay.games} días · resto de partidas: ${fmt(s.firstOfDay.restWinrate, 1)}%` }, `${fmt(s.firstOfDay.winrate, 0)}% WR`) : null, s.firstOfDay ? (s.firstOfDay.winrate >= 50 ? 'pos' : 'neg') : ''),
      kv('Mejor / peor', h('span', {}, h('span', { class: 'pos' }, `${s.streak.bestWin}V`), ' · ', h('span', { class: 'neg' }, `${s.streak.worstLoss}D`))),
      kv('LP por victoria', lp?.win != null ? `+${lp.win}` : null, 'pos'),
      kv('LP por derrota', lp?.loss != null ? `${lp.loss}` : null, 'neg')));

  return h('div', { class: 'sx' },
    head,
    h('div', { class: 'sx-body' }, kdaBox, groups),
    h('p', { class: 'sx-line' },
      'Duración media ', h('b', {}, `${fmt(s.avgDurationMin)} min`), ' · Más larga ', h('b', {}, `${fmt(s.maxDurationMin ?? null)} min`),
      ' · Pico registrado ', h('b', { class: `t-${tierKey(r)}` }, peak >= 0 ? scoreLabel(peak) : '–')),
    h('h4', { class: 'sx-h' }, 'Evolución de elo'),
    eloChart(acc));
}

// Colores por rol (paleta categórica validada para fondo oscuro; siempre acompañados de icono y texto)
const ROLE_COLOR = { TOP: '#3987e5', JUNGLE: '#d95926', MIDDLE: '#199e70', BOTTOM: '#c98500', UTILITY: '#d55181' };

function roleShareBlock(acc) {
  const br = acc.stats?.byRole;
  if (!br) return null;
  const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const counts = ROLES.map((r) => br[r]?.games ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const shares = pct100(counts);
  const main = shares.indexOf(Math.max(...shares));
  const season = acc.rank ? acc.rank.wins + acc.rank.losses : null;
  return h('div', { class: 'rs' },
    h('div', { class: 'rs-head' }, h('b', {}, 'Roles'),
      h('span', { class: 'muted' }, `${total} partidas analizadas${season ? ` de ${season} en la temporada` : ''}`)),
    h('div', { class: 'rs-bar', role: 'img', 'aria-label': ROLES.map((r, i) => `${ROLE_ES[r]} ${shares[i]}%`).join(', ') },
      ROLES.map((r, i) => (counts[i] ? h('i', { style: `flex:${counts[i]};background:${ROLE_COLOR[r]}`, title: `${ROLE_ES[r]}: ${shares[i]}% · ${counts[i]} partidas` }) : null))),
    h('div', { class: 'rs-tiles' }, ROLES.map((r, i) => {
      const x = br[r];
      return h('div', { class: `rs-tile ${i === main ? 'main' : ''} ${counts[i] ? '' : 'zero'}`, style: `--rc:${ROLE_COLOR[r]}`, title: x ? `${x.wins}V ${x.games - x.wins}D · KDA ${fmt(x.kda, 2)}` : '' },
        roleIcon(r),
        h('b', { class: 'rs-share' }, `${shares[i]}%`),
        h('span', { class: 'rs-n' }, `${counts[i]} partidas`),
        x ? h('span', { class: `rs-wr ${x.winrate >= 50 ? 'pos' : 'neg'}` }, `${fmt(x.winrate, 0)}% WR`) : h('span', { class: 'rs-wr muted' }, '–'));
    })));
}

function tabCampeones(acc) {
  const s = acc.stats;
  if (!s) return h('p', { class: 'empty' }, 'Sin partidas registradas.');
  const champs = s.champs ?? s.topChamps ?? [];
  const bwTile = (label, g, kind) => h('div', { class: 'bw-tile' },
    h('span', { class: 'lbl' }, label),
    g ? h('div', { class: 'bw-main' }, kind === 'champ' ? champIcon(g.key, 34) : roleIcon(g.key),
      h('div', {}, h('b', {}, kind === 'role' ? ROLE_ES[g.key] ?? g.key : g.key), h('span', {}, `${fmt(g.winrate)}% · ${g.games} partidas · KDA ${fmt(g.kda, 2)}`)))
      : h('span', { class: 'muted' }, 'Pocos datos (mín. 3 partidas)'));
  return h('div', { class: 'cx' },
    roleShareBlock(acc),
    h('div', { class: 'bw-grid' },
      bwTile('Mejor campeón', s.bestChamp, 'champ'), bwTile('Peor campeón', s.worstChamp, 'champ'),
      bwTile('Mejor rol', s.bestRole, 'role'), bwTile('Peor rol', s.worstRole, 'role')),
    h('div', { class: 'ctable' },
      h('div', { class: 'ct-head' }, h('span', {}, 'Campeón'), h('span', {}, 'Partidas'), h('span', {}, 'Winrate'), h('span', {}, 'KDA'), h('span', { class: 'c-cs' }, 'CS/min')),
      champs.map((c) => h('div', { class: 'ct-row' },
        h('span', { class: 'ct-name' }, champIcon(c.key, 30), h('b', {}, c.key)),
        h('span', {}, c.games),
        h('span', {}, winBar(c.wins, c.games - c.wins)),
        h('span', { class: c.kda >= 3 ? 'pos' : '' }, fmt(c.kda, 2)),
        h('span', { class: 'c-cs' }, c.csPerMin != null ? fmt(c.csPerMin) : '–')))));
}

function playerDetail(p) {
  const tab = detailTab.get(p.name) ?? 'hist';
  const ai = detailAcc.get(p.name) ?? (p.bestAccount >= 0 ? p.bestAccount : 0);
  const acc = p.accounts[ai] ?? p.main;
  const setTab = (t) => { detailTab.set(p.name, t); renderRows(); };
  const tabs = [['hist', 'Historial'], ['stats', 'Stats & Elo'], ['champs', 'Campeones']];
  return h('div', { class: 'detail' },
    h('div', { class: 'dbar' },
      h('div', { class: 'dtabs', role: 'tablist' }, tabs.map(([k, label]) =>
        h('button', { class: k === tab ? 'on' : '', role: 'tab', 'aria-selected': k === tab, onclick: () => setTab(k) }, label))),
      p.accounts.length > 1 ? h('div', { class: 'dacc' }, p.accounts.map((a, i) =>
        h('button', { class: i === ai ? 'on' : '', onclick: () => { detailAcc.set(p.name, i); renderRows(); } }, a.gameName))) : null,
      h('div', { class: 'dlinks' },
        h('button', { class: 'dl-btn', onclick: () => openCompare(p.name) }, '⚖ Comparar'),
        Object.entries(acc.links || {}).filter(([k]) => k !== 'opgg').map(([k, url]) => extLink(url, `${LINK_LABELS[k] ?? k} ↗`)),
        acc.links?.opgg ? extLink(acc.links.opgg, 'Ver en OP.GG ↗', 'main') : null)),
    acc.error ? h('p', { class: 'err' }, `No se pudo actualizar esta cuenta: ${acc.error}`) : null,
    tab === 'hist' ? tabHistorial(acc) : tab === 'stats' ? tabStats(acc) : tabCampeones(acc));
}

// ---------------------------------------------------------------- estadísticas
const STAT_CARDS = [
  { title: 'Kills', sub: 'Más asesinatos por partida', get: (s) => s.avgK, d: 1 },
  { title: 'Muertes', sub: 'Más veces eliminado por partida', get: (s) => s.avgD, d: 1 },
  { title: 'Asistencias', sub: 'Más asistencias por partida', get: (s) => s.avgA, d: 1 },
  { title: 'CS/min', sub: 'Farmeo por minuto', get: (s) => s.csPerMin, d: 1 },
  { title: 'Visión', sub: 'Puntuación de visión por minuto', get: (s) => s.visPerMin, d: 2 },
  { title: '% daño', sub: 'Parte del daño a campeones de su equipo', get: (s) => s.dmgShare, d: 1, suffix: '%' },
  { title: 'Oro @15', sub: 'Diferencia media de oro con su rival de línea al minuto 15', get: (s) => s.gold?.avgGd15, fmt: goldK, games: (s) => s.gold.games },
  { title: '1ª del día', sub: 'Winrate en la primera partida de cada día', get: (s) => (s.firstOfDay?.games >= 10 ? s.firstOfDay.winrate : null), d: 1, suffix: '%', games: (s) => s.firstOfDay.games },
  { title: 'Throws', sub: 'Partidas perdidas tras ir +3k de oro por equipo', get: (s) => s.gold?.throws, d: 0, games: (s) => s.gold.games },
];

function statCard(def, players) {
  const list = players.filter((p) => p.s && def.get(p.s) != null)
    .map((p) => ({ p, v: def.get(p.s) }))
    .sort((a, b) => b.v - a.v);
  if (!list.length) return null;
  const [first, ...rest] = list;
  const val = (v) => (def.fmt ? def.fmt(v) : `${fmt(v, def.d)}${def.suffix ?? ''}`);
  const games = (p) => (def.games ? def.games(p.s) : p.s.games);
  return h('article', { class: 'scard' },
    h('h3', { class: 'card-title' }, def.title),
    h('p', { class: 'card-sub' }, def.sub),
    h('div', { class: 'leader' },
      h('span', { class: 'leader-pos' }, '1'),
      h('div', { class: 'leader-who' }, avatar(first.p, 76, 'big'), h('b', {}, first.p.name), tierTag(first.p.rank)),
      h('div', { class: 'leader-val' }, h('b', {}, val(first.v)), h('span', {}, `${games(first.p)} partidas`))),
    h('ol', { class: 'lb', start: 2 }, rest.map((x, i) =>
      h('li', { class: `lb-row t-border-${tierKey(x.p.rank)}` },
        h('span', { class: 'lb-pos' }, i + 2), avatar(x.p, 26), h('span', { class: 'lb-name' }, x.p.name),
        h('b', { class: 'lb-val' }, val(x.v)), h('span', { class: 'lb-games' }, `${games(x.p)} partidas`)))));
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

// ---------------------------------------------------------------- roles
// Porcentajes enteros que suman exactamente 100 (método del mayor resto)
function pct100(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) out[i]++; });
  return out;
}

function rolesCard(players) {
  const rows = [...players].filter((p) => p.s?.byRole).sort(SORTERS.rank);
  if (!rows.length) return null;
  const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  return h('article', { class: 'scard wide' },
    h('h3', { class: 'card-title' }, 'Roles'),
    h('p', { class: 'card-sub' }, '% de partidas en cada rol (suma 100 %) y winrate en ese rol'),
    h('div', { class: 'rtable-wrap' }, h('table', { class: 'rtable' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Jugador'),
        ROLES.map((r) => h('th', {}, h('span', { class: 'rth' }, roleIcon(r), ROLE_ES[r]))), h('th', { title: 'Partidas analizadas / partidas de SoloQ de la temporada según Riot' }, 'Partidas'))),
      h('tbody', {}, rows.map((p) => {
        const br = p.s.byRole;
        const counts = ROLES.map((r) => br[r]?.games ?? 0);
        const shares = pct100(counts);
        const total = counts.reduce((a, b) => a + b, 0);
        const main = shares.indexOf(Math.max(...shares));
        return h('tr', {},
          h('td', { class: 'rt-player' }, avatar(p, 26), h('b', {}, p.name)),
          ROLES.map((r, i) => {
            const x = br[r];
            if (!x?.games) return h('td', { class: 'rt-cell zero' }, h('span', { class: 'rt-share' }, '0%'));
            return h('td', { class: `rt-cell ${i === main ? 'main' : ''}`, style: `--share:${shares[i]}%`, title: `${ROLE_ES[r]}: ${x.games} partidas · ${x.wins}V ${x.games - x.wins}D · KDA ${fmt(x.kda, 2)}` },
              h('span', { class: 'rt-share' }, `${shares[i]}%`),
              h('span', { class: `rt-wr ${x.winrate >= 50 ? 'pos' : 'neg'}` }, `${fmt(x.winrate, 0)}% WR`),
              h('span', { class: 'rt-n' }, `${x.games} part.`));
          }),
          h('td', { class: 'rt-total', title: 'Analizadas / temporada' }, h('b', {}, total), p.wins + p.losses > total ? h('small', {}, ` / ${p.wins + p.losses}`) : null));
      })))),
    h('p', { class: 'muted small center' }, 'Partidas de SoloQ de esta temporada de la cuenta principal. Resaltado: su rol principal. En "Partidas", analizadas / total de la temporada (mientras se descarga el historial pueden no coincidir; los remakes no cuentan).'));
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
    ['Mejor winrate de temporada', pick(elig, (r) => r.rank.winrate), (r) => `${fmt(r.rank.winrate)}%`, 'good'],
    ['Peor winrate de temporada', pick(elig, (r) => r.rank.winrate, -1), (r) => `${fmt(r.rank.winrate)}%`, 'bad'],
    ['Mejor partida', pick(rows, (r) => r.s.bestGame.kda), (r) => `${r.s.bestGame.champ} ${r.s.bestGame.k}/${r.s.bestGame.d}/${r.s.bestGame.a}`, 'good', (r) => r.s.bestGame.champ, (r) => r.s.bestGame.id],
    ['Peor partida', pick(rows, (r) => r.s.worstGame.kda, -1), (r) => `${r.s.worstGame.champ} ${r.s.worstGame.k}/${r.s.worstGame.d}/${r.s.worstGame.a}`, 'bad', (r) => r.s.worstGame.champ, (r) => r.s.worstGame.id],
  ];
  const goldRec = (key, dir = 1) => {
    const c = rows.filter((r) => r.s.gold?.[key]).map((r) => ({ p: r, g: r.s.gold[key] }));
    return c.length ? c.reduce((m, x) => (dir * (x.g.val - m.g.val) > 0 ? x : m)) : null;
  };
  const goldCard = (title, x, tone, note) => (x ? h('div', { class: `rec rec-${tone} rec-gold clickable`, role: 'button', tabindex: 0, title: 'Ver la partida',
    onclick: () => openMatchModal(x.g.id, `${title} · ${x.p.name}`, x.p.main?.riotId) },
    h('span', { class: 'rec-t' }, title),
    h('div', { class: 'rec-main' }, champIcon(x.g.champ, 34), h('b', { class: 'rec-v' }, `${goldK(x.g.val)} de oro`)),
    h('span', { class: 'rec-w' }, x.p.name, h('span', { class: 'muted' }, ` · ${x.g.champ} ${x.g.k}/${x.g.d}/${x.g.a} · ${note(x.g)} · ${ago(x.g.t)}`))) : null);
  const goldCards = [
    goldCard('Mayor throw', goldRec('biggestThrow'), 'bad', (g) => `iba ganando en el min ${g.min} y perdió`),
    goldCard('Mayor remontada', goldRec('biggestComeback', -1), 'good', () => 'iba perdiendo y ganó'),
    goldCard('Mayor ventaja de oro', goldRec('biggestLead'), 'neutral', (g) => (g.win ? 'victoria' : 'derrota')),
    goldCard('Mejor oro @15 vs rival', goldRec('best15'), 'good', (g) => (g.win ? 'victoria' : 'derrota')),
    goldCard('Peor oro @15 vs rival', goldRec('worst15', -1), 'bad', (g) => (g.win ? 'victoria' : 'derrota')),
  ].filter(Boolean);

  const cards = defs.filter((d) => d[1]).map(([title, r, fmtFn, tone, champFn, idFn]) => {
    const p = r.p && r.c ? r.p : r;
    const mid = idFn ? idFn(r) : null;
    return h('div', mid ? { class: `rec rec-${tone} clickable`, role: 'button', tabindex: 0, title: 'Ver la partida', onclick: () => openMatchModal(mid, `${title} · ${p.name}`, p.main?.riotId) } : { class: `rec rec-${tone}` },
      h('span', { class: 'rec-t' }, title),
      h('div', { class: 'rec-main' }, champFn ? champIcon(champFn(r), 34) : avatar(p, 34), h('b', { class: 'rec-v' }, fmtFn(r))),
      h('span', { class: 'rec-w' }, p.name));
  });
  document.getElementById('records-grid').replaceChildren(...goldCards, ...cards);
}

// ---------------------------------------------------------------- best 5
const ROLE_ORDER = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const MIN_ROLE_GAMES = 10;
let best5Mode = 'perf';
const MIN_CHAMP_GAMES = 3;
// Winrate ajustado: añade partidas "fantasma" al 50 % para que 3 de 3 no gane a 30 de 50.
const adjWr = (wins, games, prior = 5) => ((wins + prior) / (games + prior * 2)) * 100;

function bestChamp(champs) {
  const ok = (champs ?? []).filter((c) => c.games >= MIN_CHAMP_GAMES);
  if (!ok.length) return (champs ?? [])[0] ?? null;
  return ok.reduce((m, c) => (adjWr(c.wins, c.games, 2) > adjWr(m.wins, m.games, 2) ? c : m));
}

function computeBest5(players) {
  const cand = players.filter((p) => p.s?.byRole);
  const score = (p, role) => {
    const r = p.s.byRole[role];
    const total = Object.values(p.s.byRole).reduce((n, x) => n + x.games, 0);
    if (!r || r.games < MIN_ROLE_GAMES || r.games < total * 0.2) return null; // solo roles que juega de verdad
    return best5Mode === 'elo' ? Math.max(0, p.score) : adjWr(r.wins, r.games, 10);
  };
  // Búsqueda exhaustiva (7 jugadores × 5 roles = pocas combinaciones): maximiza la suma de puntuaciones
  let best = { total: -1, pick: [] };
  const walk = (i, used, pick, total) => {
    if (i === ROLE_ORDER.length) {
      const filled = pick.filter(Boolean).length;
      const key = filled * 1000 + total;
      if (key > best.total) best = { total: key, pick: [...pick] };
      return;
    }
    let any = false;
    for (const p of cand) {
      if (used.has(p.name)) continue;
      const sc = score(p, ROLE_ORDER[i]);
      if (sc == null) continue;
      any = true;
      used.add(p.name); pick.push(p);
      walk(i + 1, used, pick, total + sc);
      used.delete(p.name); pick.pop();
    }
    pick.push(null); walk(i + 1, used, pick, total); pick.pop();
    if (!any) return;
  };
  walk(0, new Set(), [], 0);
  return ROLE_ORDER.map((role, i) => {
    const p = best.pick[i] ?? null;
    // Mejor campeón del grupo en el rol, jugase quien lo jugase
    const pool = [];
    for (const q of cand) for (const c of q.s.byRole[role]?.champs ?? []) if (c.games >= 10) pool.push({ q, c });
    const groupChamp = pool.length ? pool.reduce((m, x) => (adjWr(x.c.wins, x.c.games, 2) > adjWr(m.c.wins, m.c.games, 2) ? x : m)) : null;
    return { role, p, r: p ? p.s.byRole[role] : null, champ: p ? bestChamp(p.s.byRole[role].champs) : null, groupChamp };
  });
}

function renderBest5(players) {
  const slots = computeBest5(players);
  const grid = document.getElementById('best5-grid');
  document.querySelectorAll('#best5-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.mode === best5Mode));
  grid.replaceChildren(...slots.map(({ role, p, r, champ, groupChamp }) => h('article', { class: `b5 ${p ? '' : 'empty'}` },
    h('div', { class: 'b5-role' }, roleIcon(role), h('b', {}, ROLE_ES[role])),
    p ? h('div', { class: 'b5-body' },
      h('div', { class: 'b5-champ' }, champIcon(champ?.key, 76), h('span', { class: 'b5-champ-name' }, champ?.key ?? '')),
      h('div', { class: 'b5-player' }, avatar(p, 30), h('div', {}, h('b', {}, p.name), tierTag(p.rank))),
      h('div', { class: 'b5-stats' },
        h('div', {}, h('b', { class: r.winrate >= 50 ? 'pos' : 'neg' }, `${fmt(r.winrate, 0)}%`), h('span', {}, 'winrate')),
        h('div', {}, h('b', {}, r.games), h('span', {}, 'partidas')),
        h('div', {}, h('b', {}, fmt(r.kda, 2)), h('span', {}, 'KDA')),
        h('div', {}, h('b', { class: (r.gd15 ?? 0) >= 0 ? 'pos' : 'neg' }, r.gd15 != null ? goldK(r.gd15) : '–'), h('span', {}, 'oro @15'))),
      champ ? h('p', { class: 'b5-note' }, `Con ${champ.key}: ${fmt(champ.winrate, 0)}% en ${champ.games} partidas`) : null)
      : h('p', { class: 'empty' }, `Nadie juega habitualmente este rol (mín. ${MIN_ROLE_GAMES} partidas y 20 % de las suyas)`),
    groupChamp ? h('div', { class: 'b5-foot' },
      h('span', { class: 'lbl' }, `Pick con mejor winrate en ${ROLE_ES[role].toLowerCase()} (de cualquiera, mín. 10)`),
      h('div', {}, champIcon(groupChamp.c.key, 22), h('b', {}, groupChamp.c.key),
        h('span', { class: 'muted' }, ` · ${groupChamp.q.name} · ${fmt(groupChamp.c.winrate, 0)}% (${groupChamp.c.games})`))) : null)));
}

// ---------------------------------------------------------------- premios
const awardsOpen = new Set();
const AWARDS = [
  { key: 'grind', icon: '⚔', title: 'El grindeador', desc: 'Más partidas ganadas en la temporada.', val: (p) => p.rank?.wins, fmt: (v) => `${v} victorias` },
  { key: 'onetrick', icon: '♛', title: 'One trick king', desc: 'Más victorias con un mismo campeón.', val: (p) => p.s?.awards?.oneTrick?.wins,
    fmt: (v, p) => `${v} victorias`, extra: (p) => p.s.awards.oneTrick.champ },
  { key: 'mainchar', icon: '★', title: 'Main character', desc: 'Mejor winrate con un mismo campeón (mínimo 30 partidas con él).', val: (p) => p.s?.awards?.mainChar?.winrate,
    fmt: (v, p) => `${fmt(v, 1)}%`, extra: (p) => `${p.s.awards.mainChar.champ} · ${p.s.awards.mainChar.games} part.` },
  { key: 'autofill', icon: '⇄', title: 'Mejor autofill', desc: 'Mejor winrate fuera de su línea principal (top y mid cuentan como la misma), mínimo 20 partidas fuera de ella.',
    val: (p) => (p.s?.awards?.autofill?.games >= 20 ? p.s.awards.autofill.winrate : null), fmt: (v) => `${fmt(v, 1)}%`, extra: (p) => `${p.s.awards.autofill.games} part. fuera de línea` },
  { key: 'streak', icon: '⚡', title: 'Sin frenos', desc: 'La racha de victorias seguidas más larga.', val: (p) => p.s?.streak?.bestWin, fmt: (v) => `${v} seguidas` },
  { key: 'penta', icon: '✋', title: 'Pentakill hunter', desc: 'Más pentakills.', val: (p) => p.s?.awards?.pentas, fmt: (v) => `${v} penta${v === 1 ? '' : 's'}` },
  { key: 'quadra', icon: '✦', title: 'Cuadra killer', desc: 'Más cuádruples asesinatos.', val: (p) => p.s?.awards?.quadras, fmt: (v) => `${v} cuadra${v === 1 ? '' : 's'}`,
    note: (rows) => (rows.some((p) => (p.s?.awards?.quadraGames ?? 0) < (p.s?.games ?? 0)) ? 'Aún descargando datos de cuádruples de partidas antiguas' : null) },
  { key: 'pool', icon: '◎', title: 'Maestro del champion pool', desc: 'Ha ganado con más campeones diferentes.', val: (p) => p.s?.awards?.champPool, fmt: (v) => `${v} campeones` },
  { key: 'consistency', icon: '◆', title: 'Consistency king', desc: 'La racha más larga de partidas seguidas con KDA de 5 o más.', val: (p) => p.s?.awards?.kdaStreak, fmt: (v) => `${v} seguidas` },
  { key: 'kda', icon: '✚', title: 'KDA player', desc: 'Mejor KDA medio por partida (mínimo 50 partidas).', val: (p) => (p.s?.games >= 50 ? p.s?.awards?.avgKda : null), fmt: (v) => `${fmt(v, 2)} KDA` },
  { key: 'sheriff', icon: '✪', title: 'El sheriff', desc: 'Más primeras sangres (first bloods).', val: (p) => p.s?.awards?.firstBloods, fmt: (v) => `${v} first bloods` },
  { key: 'pochi', icon: '☠', title: 'Pochiqueue', desc: 'La racha de derrotas seguidas más larga.', val: (p) => p.s?.streak?.worstLoss, fmt: (v) => `${v} seguidas`, bad: true },
];

const GAME_RECORDS = [
  ['kills', '⚔', 'Más kills', (v) => `${v} kills`],
  ['assists', '✚', 'Más asistencias', (v) => `${v} asist.`],
  ['damage', '✦', 'Más daño a campeones', (v) => goldK(v, false)],
  ['vision', '◉', 'Más visión', (v) => `${v} visión`],
  ['longestWin', '⌛', 'Victoria más larga', (v) => mmss(v)],
  ['kda', '◆', 'Mejor KDA', (v) => `${fmt(v, 1)} KDA`],
  ['kp', '◎', 'Mayor participación', (v) => `${v}% KP`],
  ['towers', '♜', 'Más daño a torres', (v) => goldK(v, false)],
  ['gold', '¤', 'Más oro', (v) => goldK(v, false)],
  ['csMin', '⚘', 'Mejor CS/min', (v) => `${fmt(v, 1)} CS/min`],
];

function renderAwards(players) {
  const rows = players.filter((p) => p.s);
  const cards = AWARDS.map((a) => {
    const ranked = rows.map((p) => ({ p, v: a.val(p) })).filter((x) => x.v != null && x.v > 0).sort((x, y) => y.v - x.v);
    const lead = ranked[0];
    const open = awardsOpen.has(a.key);
    const note = a.note?.(rows);
    return h('article', { class: `aw ${a.bad ? 'bad' : ''}` },
      h('div', { class: 'aw-top' }, h('span', { class: 'aw-ico', 'aria-hidden': 'true' }, a.icon),
        lead ? h('span', { class: 'aw-badge' }, a.fmt(lead.v, lead.p)) : null),
      h('h4', { class: 'aw-title' }, a.title),
      h('p', { class: 'aw-desc' }, a.desc),
      note ? h('p', { class: 'aw-note' }, note) : null,
      h('div', { class: 'aw-foot' },
        lead ? h('div', { class: 'aw-lead' }, avatar(lead.p, 28), h('div', {}, h('small', {}, 'En cabeza'), h('b', {}, lead.p.name),
          a.extra ? h('span', { class: 'aw-extra' }, a.extra(lead.p)) : null)) : h('span', { class: 'muted small' }, 'Nadie todavía'),
        ranked.length > 1 ? h('button', { class: 'aw-more', onclick: () => { open ? awardsOpen.delete(a.key) : awardsOpen.add(a.key); renderAwards(MODEL); } },
          open ? 'Ocultar ↑' : 'Ver clasificación →') : null),
      open ? h('ol', { class: 'aw-list' }, ranked.map((x, i) => h('li', {},
        h('span', { class: 'lb-pos' }, i + 1), avatar(x.p, 22), h('span', { class: 'lb-name' }, x.p.name),
        a.extra ? h('span', { class: 'aw-extra' }, a.extra(x.p)) : h('span'), h('b', {}, a.fmt(x.v, x.p))))) : null);
  });
  document.getElementById('awards').replaceChildren(...cards);

  const gcards = GAME_RECORDS.map(([key, icon, title, f]) => {
    const c = rows.filter((p) => p.s.gameRecords?.[key]).map((p) => ({ p, g: p.s.gameRecords[key] }));
    if (!c.length) return null;
    const x = c.reduce((m, y) => (y.g.val > m.g.val ? y : m));
    return h('div', { class: 'gr', role: 'button', tabindex: 0, title: 'Ver la partida',
      onclick: () => openMatchModal(x.g.id, `${title} · ${x.p.name}`, x.p.main?.riotId),
      onkeydown: (e) => { if (e.key === 'Enter') openMatchModal(x.g.id, `${title} · ${x.p.name}`, x.p.main?.riotId); } },
      h('span', { class: 'aw-ico sm', 'aria-hidden': 'true' }, icon),
      h('div', { class: 'gr-main' }, h('b', { class: 'gr-title' }, title),
        h('span', { class: 'gr-who' }, avatar(x.p, 18), x.p.name, h('span', { class: 'muted' }, ` · ${x.g.champ} ${x.g.k}/${x.g.d}/${x.g.a}`))),
      h('div', { class: 'gr-side' }, h('span', { class: 'aw-badge sm' }, f(x.g.val)), h('small', { class: 'gr-ver' }, 'Ver →')));
  }).filter(Boolean);
  document.getElementById('game-records').replaceChildren(...gcards);
}


// ---------------------------------------------------------------- dúos
const DUO_MIN = 5; // partidas juntos para tener tarjeta propia
const shortDate = (t) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: TZ });

function duoGame(g, title, meRiotId, cls) {
  const open = () => openMatchModal(g.id, title, meRiotId);
  const kdas = g.kda.map(([k, d, a]) => `${k}/${d}/${a}`);
  return h('button', {
    class: `dg ${cls}`, onclick: open,
    title: `${cls === 'w' ? 'Victoria' : 'Derrota'} · ${shortDate(g.t)}\n${g.c[0]} ${kdas[0]} · ${g.c[1]} ${kdas[1]}`,
  }, champIcon(g.c[0], 22), champIcon(g.c[1], 22));
}

function duoSide(sd, p, other) {
  const lpCls = sd.lp > 0 ? 'pos' : sd.lp < 0 ? 'neg' : '';
  const lpTitle = sd.lpEst
    ? `${sd.lpEst} partidas sin LP registrado (anteriores al 30 sep o varias seguidas): estimadas con su media de LP por victoria y por derrota`
    : 'LP registrados partida a partida';
  return h('div', { class: 'duo-side' },
    h('div', { class: 'duo-who' }, p ? avatar(p, 26) : null, h('b', {}, sd.name)),
    h('div', { class: 'kv' }, h('span', {}, 'LP juntos'),
      h('b', { class: lpCls, title: lpTitle }, `${sd.lpEst ? '≈ ' : ''}${signed(sd.lp)} LP`)),
    h('div', { class: 'kv' }, h('span', {}, `Winrate sin ${other}`),
      h('b', {}, `${fmt(sd.wrWithout)}%`, h('small', { class: 'muted' }, ` · ${fmtInt(sd.gamesWithout)} part.`))),
    h('div', { class: 'kv' }, h('span', {}, 'KDA juntos'),
      h('b', {}, `${fmt(sd.kda.k)} / ${fmt(sd.kda.d)} / ${fmt(sd.kda.a)}`, h('small', { class: 'muted' }, ` · ${fmt(sd.kda.ratio, 2)}`))),
    h('div', { class: 'duo-champs' }, sd.champs.map(([c, n]) => h('span', { class: 'duo-ch', title: `${c}: ${n} partidas` }, champIcon(c, 26), h('small', {}, n)))));
}

function duoCard(d, byName) {
  const [A, B] = d.sides;
  const pa = byName.get(d.a), pb = byName.get(d.b);
  const base = (A.wrWithout + B.wrWithout) / 2;
  const diff = d.wr - base;
  const tag = d.games < 10 ? null
    : diff >= 3 ? ['syn', `Sinergia +${fmt(diff)} pts`]
    : diff <= -3 ? ['anti', `Mejor por separado ${fmt(diff)} pts`]
    : ['neu', 'Ni suma ni resta'];
  const title = `${d.a} & ${d.b}`;
  return h('article', { class: 'duo panel' },
    h('div', { class: 'duo-head' },
      h('div', { class: 'duo-avs' }, pa ? avatar(pa, 40) : null, pb ? avatar(pb, 40) : null),
      h('div', { class: 'duo-title' }, h('b', {}, title),
        h('span', { class: 'muted' }, `${d.games} partidas · ${fmt(d.hours)} h juntos · desde el ${shortDate(d.first)}`)),
      tag ? h('span', { class: `duo-tag ${tag[0]}`, title: `Winrate juntos frente a la media de sus winrates por separado (${fmt(base)}%)` }, tag[1]) : null,
      h('button', { class: 'duo-cmp', title: `Comparar a ${d.a} y ${d.b}`, onclick: () => openCompare(d.a, d.b) }, '⚖')),
    h('div', { class: 'duo-wr' },
      h('b', { class: d.wr >= 50 ? 'pos' : 'neg' }, `${fmt(d.wr)}%`),
      h('div', { class: 'duo-bar' }, winBar(d.wins, d.losses)),
      h('div', { class: 'duo-streaks' },
        h('span', {}, h('small', {}, 'Racha'), h('span', { class: `chip ${d.streak.win ? 'chip-w' : 'chip-l'}` }, `${d.streak.n}${d.streak.win ? 'V' : 'D'}`)),
        h('span', {}, h('small', {}, 'Mejor'), h('b', { class: 'pos' }, `${d.bestWin}V`)),
        h('span', {}, h('small', {}, 'Peor'), h('b', { class: 'neg' }, `${d.bestLoss}D`)))),
    h('div', { class: 'duo-sides' }, duoSide(A, pa, d.b), duoSide(B, pb, d.a)),
    h('div', { class: 'duo-recent' }, h('small', { class: 'lbl' }, 'Últimas juntos'),
      h('div', { class: 'dg-row' }, d.recent.map((g) => duoGame(g, title, pa?.main?.riotId, g.win ? 'w' : 'l')))));
}

function renderDuos(players) {
  const byName = new Map(players.map((p) => [p.name, p]));
  const duos = DATA.duos ?? [];
  const main = duos.filter((d) => d.games >= DUO_MIN);
  const minor = duos.filter((d) => d.games < DUO_MIN);
  document.getElementById('duos-main').replaceChildren(...(main.length ? main.map((d) => duoCard(d, byName))
    : [h('p', { class: 'empty center' }, 'Todavía no hay dúos con suficientes partidas.')]));
  document.getElementById('duos-minor').replaceChildren(...(minor.length ? [
    h('h3', { class: 'aw-sub' }, 'Alguna vez juntos'),
    h('div', { class: 'duo-mini-list' }, minor.map((d) => h('div', { class: 'duo-mini' },
      h('div', { class: 'duo-avs sm' }, byName.get(d.a) ? avatar(byName.get(d.a), 24) : null, byName.get(d.b) ? avatar(byName.get(d.b), 24) : null),
      h('b', {}, `${d.a} & ${d.b}`),
      h('span', { class: 'muted' }, `${d.games} part.`),
      h('span', {}, h('span', { class: 'pos' }, `${d.wins}V`), ' ', h('span', { class: 'neg' }, `${d.losses}D`)),
      h('div', { class: 'dg-row' }, d.recent.map((g) => duoGame(g, `${d.a} & ${d.b}`, byName.get(d.a)?.main?.riotId, g.win ? 'w' : 'l')))))),
  ] : []));
  const rivals = DATA.rivals ?? [];
  document.getElementById('rivals').replaceChildren(
    h('h3', { class: 'aw-sub' }, 'Cara a cara'),
    rivals.length ? h('div', { class: 'duo-mini-list' }, rivals.map((r) => h('div', { class: 'duo-mini' },
      h('div', { class: 'duo-avs sm' }, byName.get(r.a) ? avatar(byName.get(r.a), 24) : null, byName.get(r.b) ? avatar(byName.get(r.b), 24) : null),
      h('b', {}, `${r.a} vs ${r.b}`),
      h('span', { class: 'rv-score' }, h('b', { class: r.aWins >= r.bWins ? 'pos' : 'neg' }, r.aWins), ' – ', h('b', { class: r.bWins >= r.aWins ? 'pos' : 'neg' }, r.bWins)),
      h('div', { class: 'dg-row' }, r.recent.map((g) => duoGame(g, `${r.a} vs ${r.b}`, byName.get(r.a)?.main?.riotId, g.aWin ? 'w' : 'l'))))))
      : h('p', { class: 'muted small center' }, 'Esta temporada nadie del grupo se ha cruzado como rival en SoloQ. Cuando pase, aparecerá aquí quién ganó.'));
}

// ---------------------------------------------------------------- evolución del grupo
const GE_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767', '#7fb7ff'];
const geHidden = new Set();
let geDays = 30;
let geHover = null;

function geSeries(players) {
  // Color fijo por jugador (orden de la configuración), no por posición en el ranking
  return DATA.players.map((p0, i) => {
    const p = players.find((x) => x.name === p0.name);
    if (!p?.main) return null;
    const { est, real } = eloSeries(p.main);
    const pts = [...est.map((x) => [x[0], x[1], 1]), ...real.map((x) => [x[0], x[1], 0])].sort((a, b) => a[0] - b[0]);
    if (p.score >= 0) pts.push([Date.now(), p.score, 0]);
    return { name: p.name, color: GE_COLORS[i % GE_COLORS.length], pts, rank: p.rank, p };
  }).filter((s) => s && s.pts.length >= 2);
}

function renderGroupElo(players) {
  const box = document.getElementById('ge-chart');
  if (!box) return;
  const all = geSeries(players);
  geHover = null;
  const legend = document.getElementById('ge-legend');
  legend.onmouseleave = () => geSetHover(null);
  box.onmouseleave = () => geSetHover(null);
  legend.replaceChildren(...all.map((s) => h('button', {
    class: `ge-chip ${geHidden.has(s.name) ? 'off' : ''}`, style: `--c:${s.color}`, 'aria-pressed': !geHidden.has(s.name),
    onclick: () => { geHidden.has(s.name) ? geHidden.delete(s.name) : geHidden.add(s.name); renderGroupElo(MODEL); },
    onmouseenter: () => geSetHover(s.name), onmouseleave: () => geSetHover(null),
  }, h('i'), s.name)));
  drawGe(box, all);
}

// Resaltar una línea sin redibujar (así el tooltip y el ratón no se interrumpen)
function geSetHover(name) {
  if (geHover === name && name !== null) return;
  geHover = name;
  const svgEl = document.querySelector('#ge-chart svg');
  if (!svgEl) return;
  svgEl.querySelector('.ge-top')?.remove();
  if (name) {
    const src = [...svgEl.querySelectorAll('.ge-line')].find((g) => g.dataset.name === name);
    if (src) {
      const top = src.cloneNode(true);
      top.classList.add('ge-top', 'hot');
      top.classList.remove('dim');
      top.querySelectorAll('.hit').forEach((x) => x.remove());
      top.style.pointerEvents = 'none';
      svgEl.appendChild(top);
    }
  }
  for (const g of svgEl.querySelectorAll('.ge-line')) {
    const on = g.dataset.name === name;
    g.classList.toggle('hot', on);
    g.classList.toggle('dim', !!name && !on);
  }
  for (const r of document.querySelectorAll('.ge-tr')) r.classList.toggle('dim', !!name && r.dataset.name !== name);
}

function drawGe(box, all) {
  const now = Date.now();
  const t0 = geDays ? now - geDays * 864e5 : Math.min(...all.map((s) => s.pts[0][0]));
  const vis = all.filter((s) => !geHidden.has(s.name)).map((s) => {
    // Recortar al rango, empezando en el valor que tenía en t0
    const before = s.pts.filter((p) => p[0] <= t0).at(-1);
    const inside = s.pts.filter((p) => p[0] > t0);
    const pts = before ? [[t0, before[1], before[2]], ...inside] : inside;
    return { ...s, pts };
  }).filter((s) => s.pts.length >= 1);
  const W = Math.max(320, box.clientWidth), H = W < 600 ? 300 : 380, L = 62, R = W < 600 ? 12 : 120, T = 14, B = 28;
  if (!vis.length) { box.replaceChildren(h('p', { class: 'empty' }, 'Selecciona al menos un jugador.')); return; }
  let lo = Math.min(...vis.flatMap((s) => s.pts.map((p) => p[1]))), hi = Math.max(...vis.flatMap((s) => s.pts.map((p) => p[1])));
  lo = Math.max(0, Math.floor((lo - 20) / 100) * 100); hi = Math.ceil((hi + 20) / 100) * 100;
  const x = (t) => L + ((t - t0) / Math.max(1, now - t0)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const els = [];
  const span = hi - lo;
  const step = span > 2400 ? 800 : span > 900 ? 400 : span > 300 ? 200 : 100;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    els.push(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
    const lab = v >= 2800 ? `M ${v - 2800}` : `${TIER_ES[TIERS[Math.floor(v / 400)]].slice(0, 3)} ${DIVS[Math.floor((v % 400) / 100)]}`;
    els.push(svg('text', { x: L - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, lab));
  }
  const nT = Math.max(2, Math.min(7, Math.floor((W - L - R) / 100)));
  for (let k = 0; k < nT; k++) {
    const t = t0 + ((now - t0) * k) / (nT - 1);
    els.push(svg('text', { x: x(t), y: H - 8, class: 'axis', 'text-anchor': k === 0 ? 'start' : k === nT - 1 ? 'end' : 'middle' }, prettyDay(dayKey(t))));
  }
  // Etiquetas al final de cada línea sin solaparse (separación mínima de 15 px)
  const labelY = new Map();
  const labs = vis.map((s) => ({ n: s.name, y: y(s.pts.at(-1)[1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 15) labs[i].y = labs[i - 1].y + 15;
  const over = labs.length ? labs.at(-1).y - (H - B) : 0;
  if (over > 0) for (const l of labs) l.y -= over;
  for (const l of labs) labelY.set(l.n, l.y);
  const ordered = vis;
  for (const s of ordered) {
    const dim = false;
    const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    // Tramo estimado (discontinuo) y registrado (continuo)
    const firstReal = s.pts.findIndex((p) => !p[2]);
    const estPts = firstReal === -1 ? s.pts : s.pts.slice(0, firstReal + 1);
    const realPts = firstReal === -1 ? [] : s.pts.slice(firstReal);
    const g = svg('g', { class: 'ge-line', 'data-name': s.name, style: `--c:${s.color}` });
    if (estPts.length > 1) g.append(svg('path', { d: path(estPts), class: 'est' }));
    if (realPts.length > 1) g.append(svg('path', { d: path(realPts) }));
    g.append(svg('path', { d: path(s.pts), class: 'hit' }));
    const last = s.pts.at(-1);
    g.append(svg('circle', { cx: x(last[0]), cy: y(last[1]), r: 4, class: 'end' }));
    if (R > 40) g.append(svg('text', { x: x(last[0]) + 8, y: (labelY.get(s.name) ?? y(last[1])) + 4, class: 'ge-lab' }, s.name));
    g.addEventListener('pointerenter', () => geSetHover(s.name));
    g.addEventListener('pointerleave', () => geSetHover(null));
    els.push(g);
  }
  const cross = svg('line', { class: 'ecross', y1: T, y2: H - B, x1: -10, x2: -10 });
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Evolución del elo de todos los jugadores' }, ...els, cross);
  const tip = h('div', { class: 'etip ge-tip', hidden: true });
  chart.addEventListener('pointermove', (e) => {
    const r = chart.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (px < L || px > W - R) { tip.hidden = true; cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); return; }
    const t = t0 + ((px - L) / (W - L - R)) * (now - t0);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px);
    const rows = vis.map((s) => { const p = s.pts.filter((q) => q[0] <= t).at(-1); return p ? { s, v: p[1], est: p[2] } : null; })
      .filter(Boolean).sort((a, b) => b.v - a.v);
    tip.hidden = false;
    tip.replaceChildren(h('b', {}, new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: TZ })),
      ...rows.map((row) => h('span', { class: `ge-tr ${geHover && geHover !== row.s.name ? 'dim' : ''}`, 'data-name': row.s.name },
        h('i', { style: `background:${row.s.color}` }), row.s.name, h('em', {}, `${row.est ? '≈ ' : ''}${scoreLabel(row.v)}`))));
    tip.style.left = `${Math.min(80, Math.max(20, (px / W) * 100))}%`;
    tip.style.top = '8%';
  });
  chart.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); });
  box.replaceChildren(chart, tip);
}

// ---------------------------------------------------------------- en directo
const QUEUE_ES = {
  420: 'SoloQ', 440: 'Flex', 400: 'Normal', 430: 'Normal', 490: 'Normal', 480: 'Normal', 450: 'ARAM', 700: 'Clash', 720: 'Clash ARAM',
  900: 'URF', 1900: 'URF', 1700: 'Arena', 1710: 'Arena', 1300: 'Nexus Blitz', 0: 'Personalizada',
};
function liveOf(name) {
  for (const g of LIVE) {
    const me = g.p.find((x) => x.n === name);
    if (me) return { g, me };
  }
  return null;
}
const liveMinTxt = (start) => (start ? `${Math.max(0, Math.floor((Date.now() - start) / 60000))} min` : 'cargando');
function liveMinutes(start) {
  return h('span', { class: 'live-min', 'data-start': start || '' }, liveMinTxt(start));
}
// Los minutos avanzan solos sin volver a pintar nada
function tickLive() {
  for (const el of document.querySelectorAll('.live-min')) el.textContent = liveMinTxt(Number(el.dataset.start) || 0);
}

function renderLive() {
  const box = document.getElementById('live-now');
  const chip = document.getElementById('meta-live');
  const playing = LIVE.reduce((n, g) => n + g.p.length, 0);
  chip.hidden = !playing;
  chip.querySelector('b').textContent = playing;
  chip.title = playing ? LIVE.flatMap((g) => g.p.map((x) => x.n)).join(', ') : '';
  if (!LIVE.length) { box.hidden = true; box.replaceChildren(); return; }
  const byName = new Map(MODEL.map((p) => [p.name, p]));
  box.hidden = false;
  box.replaceChildren(
    h('div', { class: 'live-head' }, h('i', { class: 'live-dot' }), h('b', {}, 'Jugando ahora'),
      h('small', { class: 'muted' }, 'se comprueba cada minuto')),
    h('div', { class: 'live-games' }, LIVE.map((g) => {
      const vs = new Set(g.p.map((x) => x.tm)).size > 1;
      const tag = vs ? h('span', { class: 'lg-tag vs' }, '¡Se enfrentan!')
        : g.p.length > 1 ? h('span', { class: 'lg-tag duo' }, g.p.length === 2 ? 'En dúo' : `${g.p.length} juntos`) : null;
      return h('div', { class: `live-game ${vs ? 'vs' : ''}` },
        h('div', { class: 'lg-top' }, h('b', {}, QUEUE_ES[g.q] ?? 'Partida'), h('span', { class: 'muted' }, '·'), liveMinutes(g.s), tag),
        h('div', { class: 'lg-players' }, g.p.map((x) => {
          const p = byName.get(x.n);
          return h('div', { class: `lg-p ${vs ? (x.tm === 100 ? 'blue' : 'red') : ''}` },
            x.c ? champIcon(x.c, 36) : p ? avatar(p, 36) : null,
            h('div', { class: 'lg-who' }, h('b', {}, x.n), h('small', {}, x.c ?? (p ? rankName(p.rank) : ''))));
        })));
    })));
}

// ---------------------------------------------------------------- tilt (aviso en el ranking)
const TILT_K = 10;
const shrink = (w, n, p0) => (w + TILT_K * p0) / (n + TILT_K);
// Punto de parada: el primer nº de derrotas seguidas tras el que su winrate cae claramente (≥ 4 puntos)
function tiltRule(t, wrPct) {
  if (!t?.prev) return null;
  const p0 = (wrPct ?? 50) / 100;
  for (let k = 1; k <= 4; k++) {
    const [w, n] = t.prev[3 + k] ?? [0, 0];
    if (n >= 12 && shrink(w, n, p0) <= p0 - 0.04) return { k, w, n, wr: (w / n) * 100 };
  }
  return null;
}
// Hoy lleva tantas derrotas seguidas como su punto de parada (3 si no tiene uno claro) y sigue en sesión
function tiltNow(p) {
  const rec = p.main?.recent ?? [];
  if (!rec.length || Date.now() - rec[0].t > 90 * 60e3) return null;
  let n = 0;
  for (let i = 0; i < rec.length; i++) {
    const g = rec[i];
    if (g.win) break;
    if (i > 0 && rec[i - 1].t - (rec[i - 1].dur ?? 0) * 1000 - g.t > 40 * 60e3) break; // de otra sesión
    n++;
  }
  const stop = tiltRule(p.s?.tilt, p.s?.winrate)?.k ?? 3;
  return n >= stop ? `${n} derrotas seguidas: a partir de ${stop} su winrate suele caer. Igual toca parar` : null;
}

// ---------------------------------------------------------------- novedades
function evParts(e) {
  const i = (e.text ?? '').indexOf(' ');
  return i > 0 ? [e.text.slice(0, i), e.text.slice(i + 1)] : ['•', e.text ?? ''];
}
function evSub(e) {
  switch (e.type) {
    case 'up': case 'down': return `viene de ${e.from}${e.lp != null ? ` · ${e.lp} LP` : ''}${e.peak ? ' · su mejor elo registrado' : ''}`;
    case 'penta': case 'quadra': case 'record': return `${e.champ} · ${e.k}/${e.d}/${e.a} · ${e.win ? 'victoria' : 'derrota'}`;
    case 'challengeStart': case 'challengeEnd': return (e.desc ?? '').split('\n')[0];
    default: return '';
  }
}
const evTime = (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

function eventItem(e, byName) {
  const [ico, txt] = evParts(e);
  const p = byName.get(e.name);
  const open = e.gameId ? () => openMatchModal(e.gameId, txt, p?.main?.riotId) : null;
  return h(open ? 'button' : 'div', { class: `ev ev-${e.type}`, onclick: open, title: open ? 'Ver la partida' : null },
    h('span', { class: 'ev-ico', 'aria-hidden': 'true' }, ico),
    h('div', { class: 'ev-main' }, h('b', {}, txt), h('small', {}, [evTime(e.t), evSub(e)].filter(Boolean).join(' · '))),
    open ? h('span', { class: 'ev-go' }, 'Ver →') : p ? avatar(p, 28) : null);
}

function renderEvents() {
  const box = document.getElementById('events');
  const list = DATA.events ?? [];
  if (!list.length) {
    box.replaceChildren(h('p', { class: 'empty' }, 'Todavía no hay novedades. Aquí saldrán las subidas y bajadas, los pentas, las rachas y los récords en cuanto pasen.'));
    return;
  }
  const byName = new Map(MODEL.map((p) => [p.name, p]));
  const today = dayKey(Date.now()), yest = dayKey(Date.now() - 864e5);
  const groups = new Map();
  for (const e of list.slice(0, 30)) {
    const k = dayKey(e.t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  box.replaceChildren(...[...groups].map(([k, evs]) => h('div', { class: 'ev-day' },
    h('h4', { class: 'ev-date' }, k === today ? 'Hoy' : k === yest ? 'Ayer' : prettyDay(k)),
    ...evs.map((e) => eventItem(e, byName)))));
}

// Aviso arriba con lo de las últimas 12 h (se puede cerrar; no vuelve a salir en este navegador)
function renderBanner() {
  const box = document.getElementById('banner');
  let seen = 0;
  try { seen = Number(localStorage.getItem('sq-banner-seen')) || 0; } catch { /* sin almacenamiento */ }
  const fresh = (DATA.events ?? []).filter((e) => Date.now() - e.t < 12 * 3600e3 && e.t > seen);
  if (!fresh.length) { box.hidden = true; return; }
  const [ico, txt] = evParts(fresh[0]);
  box.hidden = false;
  box.replaceChildren(
    h('span', { class: 'bn-ico', 'aria-hidden': 'true' }, ico),
    h('a', { href: '#novedades', class: 'bn-txt' }, h('b', {}, txt),
      h('small', {}, ` · ${ago(fresh[0].t)}${fresh.length > 1 ? ` · y ${fresh.length - 1} más` : ''}`)),
    h('button', {
      class: 'bn-x', 'aria-label': 'Cerrar aviso',
      onclick: () => { try { localStorage.setItem('sq-banner-seen', String(fresh[0].t)); } catch { /* nada */ } box.hidden = true; },
    }, '×'));
}

// ---------------------------------------------------------------- la semana
let weekTab = 'current';
let WEEKS = null; // archivo de semanas (data/weeks.json), se carga al abrir "Historial"

const weekEnd = (w) => w.to ?? Math.min(Date.now(), w.from + 7 * 864e5);
const weekSorted = (w) => [...w.players].sort((a, b) => (b.games ? 1 : 0) - (a.games ? 1 : 0) || (b.lp ?? -1e9) - (a.lp ?? -1e9) || b.games - a.games);

function weekText(w) {
  const pl = new Map(w.players.map((x) => [x.name, x]));
  const act = weekSorted(w).filter((x) => x.games);
  const idle = w.players.filter((x) => !x.games).map((x) => x.name);
  const L = [
    `📊 *SoloQ Crew · semana ${rangeLabel(w.from, weekEnd(w))}*${w.to ? '' : ' (en curso)'}`,
    `${w.totals.games} partidas · ${Math.round(pct(w.totals.wins, w.totals.games))} % de victorias · ${fmt(w.totals.hours)} h`,
    '',
    ...act.map((x, i) => `${i + 1}. *${x.name}* ${x.lp == null ? '¿?' : signed(x.lp)} LP (${x.wins}V ${x.losses}D)`),
  ];
  if (idle.length) L.push(`_No jugaron: ${idle.join(', ')}_`);
  L.push('');
  if (w.mvp) L.push(`🏆 MVP: ${w.mvp}`);
  if (w.worst) L.push(`📉 Peor semana: ${w.worst} (${signed(pl.get(w.worst).lp)} LP)`);
  if (w.grinder) L.push(`🎮 Más viciado: ${w.grinder} (${pl.get(w.grinder).games} partidas)`);
  if (w.hot) L.push(`🔥 Mejor racha: ${w.hot.name} (${w.hot.n} seguidas)`);
  if (w.cold) L.push(`💀 Peor racha: ${w.cold.name} (${w.cold.n} seguidas)`);
  if (w.duo) L.push(`🤝 Dúo de la semana: ${w.duo.a} & ${w.duo.b} (${w.duo.wins}V ${w.duo.games - w.duo.wins}D)`);
  if (w.gotw) L.push(`⭐ Partida de la semana: ${w.gotw.name}, ${w.gotw.champ} ${w.gotw.k}/${w.gotw.d}/${w.gotw.a}`);
  for (const g of w.pentas ?? []) L.push(`🖐️ Pentakill de ${g.name} con ${g.champ}`);
  L.push('', `${SITE_URL}#semana`);
  return L.join('\n');
}

function roundRect(x, X, Y, W, H, r) {
  x.beginPath();
  x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
}

// Imagen para compartir (1080 px de ancho, sin imágenes externas)
async function weekImage(w) {
  const rows = weekSorted(w);
  const hl = [];
  const pl = new Map(w.players.map((x) => [x.name, x]));
  if (w.mvp) hl.push(['🏆 MVP', w.mvp, `${signed(pl.get(w.mvp).lp)} LP`]);
  if (w.grinder) hl.push(['🎮 Más viciado', w.grinder, `${pl.get(w.grinder).games} partidas`]);
  if (w.hot) hl.push(['🔥 Mejor racha', w.hot.name, `${w.hot.n} victorias`]);
  if (w.cold) hl.push(['💀 Peor racha', w.cold.name, `${w.cold.n} derrotas`]);
  if (w.duo) hl.push(['🤝 Dúo', `${w.duo.a} & ${w.duo.b}`, `${w.duo.wins}V ${w.duo.games - w.duo.wins}D`]);
  if (w.gotw) hl.push(['⭐ Partida', w.gotw.name, `${w.gotw.champ} ${w.gotw.k}/${w.gotw.d}/${w.gotw.a}`]);
  const W = 1080, RH = 78, H = 330 + rows.length * (RH + 10) + Math.ceil(hl.length / 2) * 130 + 120;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  try { await document.fonts?.ready; } catch { /* fuentes del sistema */ }
  const F = (wt, size, it = '') => `${it} ${wt} ${size}px Archivo, system-ui, sans-serif`;
  x.fillStyle = '#0a0a0b'; x.fillRect(0, 0, W, H);
  const glow = x.createRadialGradient(W / 2, -120, 40, W / 2, -120, 760);
  glow.addColorStop(0, 'rgba(214,255,61,.20)'); glow.addColorStop(1, 'rgba(214,255,61,0)');
  x.fillStyle = glow; x.fillRect(0, 0, W, H);
  x.fillStyle = '#d6ff3d'; roundRect(x, 60, 56, 70, 70, 18); x.fill();
  x.fillStyle = '#0a0a0b'; x.font = F(900, 32, 'italic'); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('SQ', 95, 92);
  x.textAlign = 'left'; x.fillStyle = '#f4f4f5'; x.font = F(900, 30); x.fillText('SOLOQ', 150, 92);
  x.fillStyle = '#d6ff3d'; x.fillText('CREW', 150 + x.measureText('SOLOQ ').width, 92);
  x.fillStyle = '#f4f4f5'; x.font = F(900, 86, 'italic'); x.textBaseline = 'alphabetic'; x.fillText('LA SEMANA', 56, 228);
  x.fillStyle = '#a9a9b2'; x.font = F(600, 30);
  x.fillText(`${rangeLabel(w.from, weekEnd(w))}${w.to ? '' : ' (en curso)'} · ${w.totals.games} partidas · ${Math.round(pct(w.totals.wins, w.totals.games))} % victorias`, 60, 282);
  let y = 320;
  rows.forEach((r, i) => {
    x.fillStyle = i === 0 && r.games ? 'rgba(214,255,61,.10)' : '#151517'; roundRect(x, 56, y, W - 112, RH, 16); x.fill();
    x.fillStyle = r.games ? '#d6ff3d' : '#55555d'; x.font = F(900, 34, 'italic'); x.textBaseline = 'middle';
    x.fillText(r.games ? String(i + 1) : '–', 84, y + RH / 2);
    x.fillStyle = r.games ? '#f4f4f5' : '#6a6a73'; x.font = F(800, 34); x.fillText(r.name, 140, y + RH / 2);
    x.textAlign = 'right';
    if (r.games) {
      x.fillStyle = r.lp > 0 ? '#33d69a' : r.lp < 0 ? '#f2657e' : '#cfcfd6'; x.font = F(900, 38);
      x.fillText(r.lp == null ? '¿?' : `${signed(r.lp)} LP`, W - 84, y + RH / 2 - 2);
      x.fillStyle = '#8e8e97'; x.font = F(600, 24); x.fillText(`${r.wins}V ${r.losses}D`, W - 300, y + RH / 2);
    } else { x.fillStyle = '#6a6a73'; x.font = F(600, 26); x.fillText('no jugó', W - 84, y + RH / 2); }
    x.textAlign = 'left';
    y += RH + 10;
  });
  y += 20;
  hl.forEach(([label, who, val], i) => {
    const col = i % 2, X = 56 + col * ((W - 112) / 2 + 8), Y = y + Math.floor(i / 2) * 130;
    x.fillStyle = '#151517'; roundRect(x, X, Y, (W - 112) / 2 - 8, 118, 16); x.fill();
    x.textBaseline = 'alphabetic';
    x.fillStyle = '#d6ff3d'; x.font = F(800, 24); x.fillText(label.toUpperCase(), X + 24, Y + 38);
    x.fillStyle = '#f4f4f5'; x.font = F(900, 30); x.fillText(who.length > 24 ? `${who.slice(0, 23)}…` : who, X + 24, Y + 76);
    x.fillStyle = '#a9a9b2'; x.font = F(600, 24); x.fillText(val, X + 24, Y + 106);
  });
  x.fillStyle = '#6a6a73'; x.font = F(600, 24); x.textAlign = 'center';
  x.fillText(SITE_URL.replace('https://', ''), W / 2, H - 40);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

async function shareWeek(w, btn) {
  const old = btn.textContent;
  btn.textContent = 'Generando…';
  try {
    const blob = await weekImage(w);
    const file = new File([blob], `soloq-crew-${w.key}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'SoloQ Crew · la semana' }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(blob), download: file.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } finally { btn.textContent = old; }
}

async function copyText(text, btn, done = '¡Copiado!') {
  const old = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = done; } catch {
    // Sin permiso de portapapeles: se muestra para copiarlo a mano
    openModal('Copiar', h('textarea', { class: 'copy-area', readonly: true, rows: 14 }, text));
    return;
  }
  setTimeout(() => { btn.textContent = old; }, 1600);
}

function weekHighlights(w, byName) {
  const P = (n) => byName.get(n);
  const pl = new Map(w.players.map((x) => [x.name, x]));
  const card = (ico, label, name, value, extra, onclick) => h(onclick ? 'button' : 'div', { class: `wk-hl ${onclick ? 'click' : ''}`, onclick },
    h('span', { class: 'wk-lbl' }, h('span', { 'aria-hidden': 'true' }, ico), ` ${label}`),
    h('div', { class: 'wk-who' }, name && P(name) ? avatar(P(name), 26) : null, h('b', {}, name ?? '–')),
    h('span', { class: 'wk-val' }, value, extra ? h('small', {}, ` · ${extra}`) : null));
  const out = [];
  if (w.mvp) { const x = pl.get(w.mvp); out.push(card('🏆', 'MVP', w.mvp, `${signed(x.lp)} LP`, `${x.wins}V ${x.losses}D`)); }
  if (w.worst) { const x = pl.get(w.worst); out.push(card('📉', 'Peor semana', w.worst, `${signed(x.lp)} LP`, `${x.wins}V ${x.losses}D`)); }
  if (w.grinder) { const x = pl.get(w.grinder); out.push(card('🎮', 'Más viciado', w.grinder, `${x.games} partidas`, `${fmt(x.hours)} h`)); }
  if (w.hot) out.push(card('🔥', 'Mejor racha', w.hot.name, `${w.hot.n} victorias seguidas`));
  if (w.cold) out.push(card('💀', 'Peor racha', w.cold.name, `${w.cold.n} derrotas seguidas`));
  if (w.duo) {
    out.push(h('div', { class: 'wk-hl' }, h('span', { class: 'wk-lbl' }, '🤝 Dúo de la semana'),
      h('div', { class: 'wk-who' }, h('span', { class: 'duo-avs sm' }, P(w.duo.a) ? avatar(P(w.duo.a), 24) : null, P(w.duo.b) ? avatar(P(w.duo.b), 24) : null), h('b', {}, `${w.duo.a} & ${w.duo.b}`)),
      h('span', { class: 'wk-val' }, `${w.duo.games} partidas`, h('small', {}, ` · ${w.duo.wins}V ${w.duo.games - w.duo.wins}D`))));
  }
  if (w.gotw) out.push(card('⭐', 'Partida de la semana', w.gotw.name, `${w.gotw.champ} ${w.gotw.k}/${w.gotw.d}/${w.gotw.a}`, 'ver →', () => openMatchModal(w.gotw.id, `Partida de la semana · ${w.gotw.name}`, P(w.gotw.name)?.main?.riotId)));
  for (const g of w.pentas ?? []) out.push(card('🖐️', 'Pentakill', g.name, `${g.champ} ${g.k}/${g.d}/${g.a}`, 'ver →', () => openMatchModal(g.id, `Pentakill · ${g.name}`, P(g.name)?.main?.riotId)));
  return out;
}

function weekTable(w, byName) {
  return h('div', { class: 'wk-table' },
    h('div', { class: 'wk-row wk-th' }, h('span', {}, '#'), h('span', {}, 'Jugador'), h('span', {}, 'LP'), h('span', { class: 'wk-wl' }, 'V / D'),
      h('span', { class: 'wk-h' }, 'Horas'), h('span', { class: 'wk-k' }, 'KDA')),
    weekSorted(w).map((x, i) => {
      const p = byName.get(x.name);
      const idle = !x.games;
      return h('div', { class: `wk-row ${idle ? 'idle' : ''}` },
        h('span', { class: 'lb-pos' }, idle ? '–' : i + 1),
        h('span', { class: 'wk-name' }, p ? avatar(p, 28) : null, h('b', {}, x.name)),
        h('b', { class: `wk-lp ${x.lp > 0 ? 'pos' : x.lp < 0 ? 'neg' : 'muted'}`, title: x.start != null && x.end != null ? `${scoreLabel(x.start)} → ${scoreLabel(x.end)}` : '' },
          idle ? 'no jugó' : x.lp == null ? '¿?' : `${signed(x.lp)} LP`),
        h('span', { class: 'wk-wl' }, idle ? null : winBar(x.wins, x.losses)),
        h('span', { class: 'wk-h' }, idle ? '' : `${fmt(x.hours)} h`),
        h('span', { class: 'wk-k' }, idle ? '' : fmt((x.k + x.a) / Math.max(1, x.d), 2)));
    }));
}

function weekView(w, byName) {
  const stale = !w.to && w.key !== weekKeyOf(Date.now());
  if (stale) return [h('p', { class: 'empty' }, 'Esta semana todavía no ha jugado nadie.')];
  const copyBtn = h('button', { class: 'ghost-btn', onclick: () => copyText(weekText(w), copyBtn) }, '📋 Copiar resumen');
  const imgBtn = h('button', { class: 'ghost-btn', onclick: () => shareWeek(w, imgBtn) }, '🖼️ Compartir imagen');
  return [
    h('div', { class: 'wk-head' },
      h('div', {}, h('b', { class: 'wk-range' }, rangeLabel(w.from, weekEnd(w))), w.to ? null : h('span', { class: 'chip chip-w wk-live' }, 'en curso'),
        h('span', { class: 'muted' }, ` · ${w.totals.games} partidas · ${Math.round(pct(w.totals.wins, w.totals.games))} % de victorias · ${fmt(w.totals.hours)} h jugadas`)),
      h('div', { class: 'wk-actions' }, copyBtn, imgBtn)),
    w.totals.games ? h('div', { class: 'wk-hls' }, weekHighlights(w, byName)) : null,
    weekTable(w, byName),
    h('p', { class: 'muted small center' }, 'LP: diferencia entre el elo registrado al empezar y al acabar la semana (pasa el ratón para verlo). "¿?": sin registro de LP.'),
  ];
}

async function weekArchiveView(byName) {
  if (!WEEKS) {
    try {
      const r = await fetch(`data/weeks.json?t=${Math.floor(Date.now() / 6e5)}`);
      WEEKS = r.ok ? (await r.json()).weeks ?? [] : [];
    } catch { WEEKS = []; }
  }
  if (!WEEKS.length) return [h('p', { class: 'empty' }, 'Todavía no hay semanas cerradas.')];
  const wins = Object.entries(DATA.weekWins ?? {}).sort((a, b) => b[1] - a[1]);
  return [
    wins.length ? h('div', { class: 'wk-wins' }, h('span', { class: 'lbl' }, 'Semanas ganadas (MVP)'),
      ...wins.map(([n, c]) => h('span', { class: 'wk-win' }, byName.get(n) ? avatar(byName.get(n), 24) : null, h('b', {}, n), h('span', { class: 'chip chip-w' }, `×${c}`)))) : null,
    h('div', { class: 'wk-arch' }, WEEKS.map((w) => {
      const top = weekSorted(w).filter((x) => x.games).slice(0, 3);
      const open = () => { weekTab = 'w:' + w.key; renderWeek(); };
      return h('button', { class: 'wk-card', onclick: open },
        h('div', { class: 'wk-card-top' }, h('b', {}, rangeLabel(w.from, w.to)), h('small', { class: 'muted' }, `${w.totals.games} partidas`)),
        w.mvp ? h('div', { class: 'wk-card-mvp' }, byName.get(w.mvp) ? avatar(byName.get(w.mvp), 30) : null,
          h('div', {}, h('small', {}, '🏆 MVP'), h('b', {}, w.mvp))) : h('div', { class: 'muted small' }, 'Sin MVP'),
        h('ol', { class: 'wk-card-top3' }, top.map((x) => h('li', {}, h('span', {}, x.name), h('b', { class: x.lp > 0 ? 'pos' : x.lp < 0 ? 'neg' : '' }, x.lp == null ? '¿?' : signed(x.lp))))));
    })),
  ];
}

async function renderWeek() {
  const box = document.getElementById('week');
  const byName = new Map(MODEL.map((p) => [p.name, p]));
  for (const b of document.querySelectorAll('#week-tabs button')) b.classList.toggle('on', b.dataset.week === (weekTab.startsWith('w:') ? 'archive' : weekTab));
  if (weekTab === 'archive') { box.replaceChildren(...(await weekArchiveView(byName))); return; }
  let w = weekTab === 'current' ? DATA.week?.current : weekTab === 'last' ? DATA.week?.last : null;
  if (weekTab.startsWith('w:')) w = (WEEKS ?? []).find((x) => x.key === weekTab.slice(2)) ?? null;
  if (!w) { box.replaceChildren(h('p', { class: 'empty' }, 'Todavía no hay datos de esta semana.')); return; }
  const back = weekTab.startsWith('w:') ? h('button', { class: 'ghost-btn wk-back', onclick: () => { weekTab = 'archive'; renderWeek(); } }, '← Volver al historial') : null;
  box.replaceChildren(...[back, ...weekView(w, byName)].filter(Boolean));
}

// ---------------------------------------------------------------- retos
const CH_TYPE = { race: 'Carrera de LP', target: 'Llegar a un rango', handicap: 'Con hándicap', games: 'Constancia' };
const daysTxt = (ms) => { const d = Math.ceil(ms / 864e5); return d <= 1 ? 'mañana' : `en ${d} días`; };
function challengeState(c) {
  const now = Date.now();
  if (now < c.from) return { cls: 'soon', label: `Empieza ${daysTxt(c.from - now)}` };
  if (now < c.to) {
    const d = Math.ceil((c.to - now) / 864e5);
    return { cls: 'on', label: d <= 1 ? 'Último día' : `En juego · quedan ${d} días` };
  }
  return { cls: 'done', label: 'Terminado' };
}

function challengeCard(c, byName) {
  const st = challengeState(c);
  const finished = st.cls === 'done';
  const maxAbs = Math.max(1, ...c.standings.map((s) => Math.abs(s.value ?? 0)));
  const goal = c.type === 'target' && c.target ? `Meta: ${c.target}` : c.type === 'games' ? `Mínimo ${c.perWeek} partidas por semana` : c.type === 'handicap' ? 'Cada uno con su objetivo de LP' : 'Gana quien más LP sume';
  const rows = c.standings.map((s, i) => {
    let bar;
    if (c.type === 'race') {
      const w = (Math.abs(s.value) / maxAbs) * 50;
      bar = h('div', { class: 'ch-div' }, h('i', { class: s.value >= 0 ? 'up' : 'down', style: s.value >= 0 ? `left:50%;width:${w}%` : `right:50%;width:${w}%` }));
    } else if (c.type === 'games') {
      bar = h('div', { class: 'ch-weeks' }, (s.weeks ?? []).map((n, wi) => h('i', {
        class: n >= c.perWeek ? 'ok' : wi === s.weeks.length - 1 && !finished ? 'cur' : 'ko',
        title: `Semana ${wi + 1}: ${n} partidas`,
      }, n)));
    } else {
      bar = h('div', { class: 'ch-prog' }, h('i', { class: s.done ? 'done' : '', style: `width:${Math.min(100, (s.value ?? 0) * 100)}%` }));
    }
    const winner = finished && c.winners?.includes(s.name);
    const p = byName.get(s.name);
    return h('div', { class: `ch-row ${winner ? 'win' : ''}` },
      h('span', { class: 'lb-pos' }, winner ? '🏆' : i + 1),
      h('span', { class: 'ch-name' }, p ? avatar(p, 26) : null, h('b', {}, s.name)),
      bar,
      h('b', { class: `ch-val ${c.type === 'race' ? (s.value > 0 ? 'pos' : s.value < 0 ? 'neg' : '') : s.done ? 'pos' : ''}` }, s.label));
  });
  return h('article', { class: `ch panel ch-${st.cls}` },
    h('div', { class: 'ch-head' },
      h('div', {}, h('span', { class: 'ch-type' }, CH_TYPE[c.type] ?? c.type), h('h3', { class: 'ch-title' }, c.title),
        h('span', { class: 'muted small' }, `${rangeLabel(c.from, c.to)} · ${goal}`)),
      h('span', { class: `ch-state ${st.cls}` }, st.label)),
    c.desc ? h('p', { class: 'ch-desc' }, c.desc) : null,
    c.stake ? h('p', { class: 'ch-stake' }, '🎲 En juego: ', h('b', {}, c.stake)) : null,
    finished && c.winners?.length ? h('p', { class: 'ch-winner' }, `🏆 ${c.winners.join(' y ')} gana${c.winners.length > 1 ? 'n' : ''} el reto`) : null,
    st.cls === 'soon' ? h('div', { class: 'ch-soon' },
      h('span', { class: 'muted small' }, 'Participan:'),
      h('div', { class: 'ch-parts' }, c.standings.map((s) => h('span', { class: 'ch-part' }, byName.get(s.name) ? avatar(byName.get(s.name), 22) : null, s.name))),
      h('span', { class: 'muted small' }, 'Cuando empiece, aquí saldrá la clasificación en directo.'))
      : h('div', { class: 'ch-rows' }, rows));
}

function renderChallenges() {
  const box = document.getElementById('challenges');
  const list = DATA.challenges ?? [];
  const byName = new Map(MODEL.map((p) => [p.name, p]));
  const help = h('div', { class: 'ch-help' },
    h('b', {}, '¿Queréis montar un reto? '), 'Decidle a xALOzZ cuál y se añade: ',
    h('span', {}, 'carrera de LP entre dos fechas, llegar a un rango antes de un día, hándicap (cada uno con su objetivo) o constancia (mínimo de partidas por semana)'),
    ', con lo que haya en juego.');
  if (!list.length) { box.replaceChildren(h('p', { class: 'empty' }, 'No hay retos todavía.'), help); return; }
  const order = { on: 0, soon: 1, done: 2 };
  const sorted = [...list].sort((a, b) => order[challengeState(a).cls] - order[challengeState(b).cls] || b.to - a.to);
  box.replaceChildren(...sorted.map((c) => challengeCard(c, byName)), help);
}

// ---------------------------------------------------------------- flex y clash
function renderFlex() {
  const box = document.getElementById('flex-box');
  const f = DATA.flex;
  const byName = new Map(MODEL.map((p) => [p.name, p]));
  if (!f || (!f.players?.length && !f.lineups?.length && !f.clash?.length)) {
    box.replaceChildren(h('p', { class: 'empty' }, 'Todavía no hay partidas de Flex ni de Clash esta temporada. En cuanto juguéis, aparecerán aquí vuestro rango de Flex y las alineaciones que más ganan.'));
    return;
  }
  const ranks = [...(f.players ?? [])].sort((a, b) => rankScore(b.rank) - rankScore(a.rank) || b.games - a.games);
  const lineups = [...(f.lineups ?? [])].sort((a, b) => b.n - a.n || b.wr - a.wr);
  const best = lineups.filter((l) => l.n >= 5).reduce((m, l) => (!m || adjWr(l.w, l.n, 3) > adjWr(m.w, m.n, 3) ? l : m), null);
  const avs = (names, size = 26) => h('span', { class: 'duo-avs sm' }, names.map((n) => (byName.get(n) ? avatar(byName.get(n), size) : null)));
  const gameRow = (g) => h('button', { class: `fx-game ${g.win ? 'win' : 'loss'}`, onclick: () => openMatchModal(g.id, `${QUEUE_ES[g.q] ?? 'Partida'} · ${g.members.map((m) => m.name).join(', ')}`, byName.get(g.members[0]?.name)?.main?.riotId) },
    h('b', { class: g.win ? 'pos' : 'neg' }, g.win ? 'Victoria' : 'Derrota'),
    h('span', { class: 'muted' }, `${shortDate(g.t)} · ${mmss(g.dur ?? 0)}`),
    h('span', { class: 'fx-members' }, g.members.map((m) => h('span', { class: 'fx-m', title: `${m.name} · ${m.champ} ${m.k}/${m.d}/${m.a}` }, champIcon(m.champ, 26), h('small', {}, m.name)))));
  box.replaceChildren(
    ranks.length ? h('div', { class: 'fx-ranks' }, ranks.map((x) => {
      const p = byName.get(x.name);
      return h('div', { class: 'fx-rank' },
        p ? avatar(p, 34) : null,
        h('div', { class: 'fx-who' }, h('b', {}, x.name), h('small', { class: 'muted' }, `${x.games} partida${x.games === 1 ? '' : 's'} de Flex${x.clash ? ` · ${x.clash} de Clash` : ''}`)),
        crest(x.rank, 34),
        h('div', { class: 'fx-elo' }, h('b', { class: `t-${tierKey(x.rank)}` }, rankName(x.rank)),
          x.rank ? h('small', {}, `${x.rank.lp} LP · ${x.rank.wins}V ${x.rank.losses}D`) : h('small', { class: 'muted' }, 'sin clasificar')));
    })) : null,
    h('h3', { class: 'aw-sub' }, 'Alineaciones'),
    lineups.length ? h('div', { class: 'fx-lineups' }, lineups.map((l) => h('div', { class: `fx-line ${l === best ? 'best' : ''}` },
      avs(l.names),
      h('div', { class: 'fx-line-names' }, h('b', {}, l.names.join(' · ')),
        h('small', { class: 'muted' }, [l.flex ? `${l.flex} de Flex` : null, l.clash ? `${l.clash} de Clash` : null, `última: ${shortDate(l.last)}`].filter(Boolean).join(' · '))),
      l === best ? h('span', { class: 'duo-tag syn' }, 'La que más gana') : h('span'),
      h('div', { class: 'fx-line-wr' }, winBar(l.w, l.n - l.w)))))
      : h('p', { class: 'empty' }, 'Aún no habéis jugado Flex o Clash juntos.'),
    f.recent?.length ? h('h3', { class: 'aw-sub' }, 'Últimas partidas de Flex en grupo') : null,
    f.recent?.length ? h('div', { class: 'fx-games' }, f.recent.slice(0, 10).map(gameRow)) : null,
    f.clash?.length ? h('h3', { class: 'aw-sub' }, 'Clash') : null,
    f.clash?.length ? h('div', { class: 'fx-games' }, f.clash.slice(0, 15).map(gameRow)) : null);
}

// ---------------------------------------------------------------- tilt y horarios
let tiltWho = 'Grupo';
const DOW_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const BANDS = ['0–4 h', '4–8 h', '8–12 h', '12–16 h', '16–20 h', '20–24 h'];
const SESSION_L = ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª+'];
const PREV_L = ['3+ V', '2 V', '1 V', '1ª', '1 D', '2 D', '3 D', '4+ D'];
const HOURS_L = ['< 1 h', '1–2 h', '2–3 h', '3 h +'];

function tiltData(name) {
  const rows = MODEL.filter((p) => p.s?.tilt);
  const pick = name === 'Grupo' ? rows : rows.filter((p) => p.name === name);
  if (!pick.length) return null;
  const sum = (key) => pick[0].s.tilt[key].map((_, i) => pick.reduce((acc, p) => {
    const c = p.s.tilt[key][i] ?? [0, 0];
    return [acc[0] + c[0], acc[1] + c[1]];
  }, [0, 0]));
  const t = { hour: sum('hour'), dow: sum('dow'), grid: sum('grid'), session: sum('session'), prev: sum('prev'), hoursIn: sum('hoursIn') };
  const w = t.dow.reduce((s, c) => s + c[0], 0), n = t.dow.reduce((s, c) => s + c[1], 0);
  return { t, p0: n ? w / n : 0.5, n, sessions: pick.reduce((s, p) => s + (p.s.tilt.sessions ?? 0), 0) };
}

const wrColor = (d) => {
  const a = Math.min(0.85, Math.abs(d) * 6);
  return d >= 0 ? `rgba(51, 214, 154, ${a})` : `rgba(242, 101, 126, ${a})`;
};

function wrBars(title, sub, cells, labels, p0) {
  return h('div', { class: 'tl-card' }, h('h4', { class: 'tl-title' }, title), sub ? h('p', { class: 'tl-sub' }, sub) : null,
    h('div', { class: 'wrbars', style: `--cols:${cells.length}` }, cells.map(([w, n], i) => {
      const raw = n ? w / n : null;
      const d = n ? shrink(w, n, p0) - p0 : 0;
      const hgt = raw == null ? 0 : Math.max(3, Math.min(100, ((raw - 0.25) / 0.5) * 100));
      return h('div', { class: `wb ${n < 10 ? 'low' : ''}`, title: n ? `${labels[i]}: ${w}V ${n - w}D (${fmt(raw * 100, 1)} %)` : `${labels[i]}: sin partidas` },
        h('span', { class: `wb-v ${d > 0.015 ? 'pos' : d < -0.015 ? 'neg' : ''}` }, raw == null ? '–' : `${Math.round(raw * 100)}%`),
        h('div', { class: 'wb-track' }, h('i', { class: 'wb-50' }), h('i', { class: 'wb-bar', style: `height:${hgt}%;background:${n < 10 ? '#3a3a41' : d >= 0 ? 'var(--win)' : 'var(--loss)'};opacity:${n < 10 ? 1 : 0.45 + Math.min(0.55, Math.abs(d) * 6)}` })),
        h('span', { class: 'wb-l' }, labels[i]),
        h('span', { class: 'wb-n' }, `${n}`));
    })));
}

function renderTilt() {
  const who = document.getElementById('tilt-who');
  const box = document.getElementById('tilt-box');
  const rows = MODEL.filter((p) => p.s?.tilt);
  if (!rows.length) { who.replaceChildren(); box.replaceChildren(h('p', { class: 'empty' }, 'Todavía no hay partidas suficientes.')); return; }
  if (tiltWho !== 'Grupo' && !rows.some((p) => p.name === tiltWho)) tiltWho = 'Grupo';
  who.replaceChildren(...['Grupo', ...rows.map((p) => p.name)].map((n) => h('button', {
    class: `ge-chip ${n === tiltWho ? 'on' : ''}`, style: '--c: var(--accent)', 'aria-pressed': n === tiltWho,
    onclick: () => { tiltWho = n; renderTilt(); },
  }, h('i'), n === 'Grupo' ? 'Todo el grupo' : n)));
  const D = tiltData(tiltWho);
  const { t, p0 } = D;

  // Mejor y peor momento (día × franja con al menos 15 partidas)
  const cells = t.grid.map(([w, n], i) => ({ i, w, n, adj: n ? shrink(w, n, p0) : p0 })).filter((c) => c.n >= 15);
  const bestC = cells.length ? cells.reduce((m, c) => (c.adj > m.adj ? c : m)) : null;
  const worstC = cells.length ? cells.reduce((m, c) => (c.adj < m.adj ? c : m)) : null;
  const cellName = (c) => `${DOW_ES[Math.floor(c.i / 6)].toLowerCase()} de ${BANDS[c.i % 6].replace(' h', '')} h`;
  const player = MODEL.find((p) => p.name === tiltWho);
  const rule = tiltWho === 'Grupo' ? tiltRule({ prev: t.prev }, p0 * 100) : tiltRule(player?.s?.tilt, player?.s?.winrate);
  const [fw, fn] = t.session[0];
  const afterW = [t.prev[0], t.prev[1]].reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
  const tips = [];
  if (rule) tips.push(['🧊', `Tras ${rule.k} derrota${rule.k > 1 ? 's' : ''} seguida${rule.k > 1 ? 's' : ''} ${tiltWho === 'Grupo' ? 'ganáis' : 'ganas'} el ${fmt(rule.wr, 0)} % (${rule.n} partidas). ${tiltWho === 'Grupo' ? 'Ese es vuestro punto para parar.' : 'Ese es tu punto para parar.'}`]);
  else tips.push(['😌', 'No se ve un bajón claro después de perder: las derrotas seguidas no afectan más de lo normal.']);
  if (afterW[1] >= 20 && shrink(afterW[0], afterW[1], p0) >= p0 + 0.03) tips.push(['🔥', `Con 2 o más victorias seguidas, el winrate sube al ${fmt(pct(afterW[0], afterW[1]), 0)} %: si vas en racha, sigue.`]);
  if (fn >= 20) tips.push(['☕', `En la primera partida de cada sesión: ${fmt(pct(fw, fn), 0)} % (${fn} sesiones).`]);
  if (bestC) tips.push(['📈', `Mejor momento: ${cellName(bestC)} (${fmt(pct(bestC.w, bestC.n), 0)} % en ${bestC.n} partidas).`]);
  if (worstC && worstC !== bestC) tips.push(['📉', `Peor momento: ${cellName(worstC)} (${fmt(pct(worstC.w, worstC.n), 0)} % en ${worstC.n} partidas).`]);

  const heat = h('div', { class: 'tl-card tl-heat' },
    h('h4', { class: 'tl-title' }, 'Winrate por día y hora'),
    h('p', { class: 'tl-sub' }, 'Hora de inicio de la partida (Madrid) · verde: mejor que la media, rojo: peor · las casillas con pocas partidas salen apagadas'),
    h('div', { class: 'heat' },
      h('span'), ...BANDS.map((b) => h('span', { class: 'heat-h' }, b)),
      ...DOW_ES.flatMap((d, di) => [h('span', { class: 'heat-d' }, d.slice(0, 3)), ...BANDS.map((b, bi) => {
        const [w, n] = t.grid[di * 6 + bi];
        const d0 = n ? shrink(w, n, p0) - p0 : 0;
        return h('span', { class: `heat-c ${n < 10 ? 'low' : ''}`, style: n >= 10 ? `background:${wrColor(d0)}` : '', title: n ? `${d} ${b}: ${w}V ${n - w}D (${fmt(pct(w, n), 1)} %)` : `${d} ${b}: sin partidas` },
          n ? h('b', {}, `${Math.round(pct(w, n))}%`) : '·', n ? h('small', {}, n) : null);
      })])));

  box.replaceChildren(
    h('div', { class: 'tl-card tl-rules' },
      h('h4', { class: 'tl-title' }, tiltWho === 'Grupo' ? 'Lo que dicen vuestros datos' : `Lo que dicen los datos de ${tiltWho}`),
      h('p', { class: 'tl-sub' }, `${fmtInt(D.n)} partidas en ${fmtInt(D.sessions)} sesiones · winrate medio ${fmt(p0 * 100, 1)} %`),
      h('ul', { class: 'tl-tips' }, tips.map(([i, txt]) => h('li', {}, h('span', { 'aria-hidden': 'true' }, i), h('span', {}, txt))))),
    heat,
    wrBars('Según cómo venías', 'Resultado de la partida anterior en la misma sesión (V: victorias seguidas, D: derrotas seguidas)', t.prev, PREV_L, p0),
    wrBars('Según la partida de la sesión', 'Primera, segunda, tercera… partida desde que empezaste a jugar', t.session, SESSION_L, p0),
    wrBars('Según las horas seguidas jugando', 'Tiempo desde el inicio de la sesión', t.hoursIn, HOURS_L, p0),
    wrBars('Por día de la semana', null, t.dow, DOW_ES.map((d) => d.slice(0, 3)), p0));
}

// ---------------------------------------------------------------- campeones del grupo
let champsShowAll = false;
function renderChampsGroup() {
  const box = document.getElementById('champs-box');
  const rows = MODEL.filter((p) => p.s?.champs?.length);
  if (!rows.length) { box.replaceChildren(h('p', { class: 'empty' }, 'Sin datos todavía.')); return; }

  // Dueño de cada campeón: el que mejor lo juega (winrate ajustado, mín. 5 partidas)
  const byChamp = new Map();
  for (const p of rows) {
    for (const c of p.s.champs) {
      const e = byChamp.get(c.key) ?? { key: c.key, total: 0, players: [] };
      e.total += c.games;
      e.players.push({ p, c });
      byChamp.set(c.key, e);
    }
  }
  const owned = [...byChamp.values()].map((e) => {
    const cands = e.players.filter((x) => x.c.games >= 5);
    const owner = cands.length ? cands.reduce((m, x) => (adjWr(x.c.wins, x.c.games, 3) > adjWr(m.c.wins, m.c.games, 3) ? x : m)) : null;
    return { ...e, owner };
  }).filter((e) => e.owner).sort((a, b) => b.total - a.total);
  const shown = champsShowAll ? owned : owned.slice(0, 24);
  const tiles = shown.map((e) => {
    const others = e.players.filter((x) => x !== e.owner).sort((a, b) => b.c.games - a.c.games)
      .map((x) => `${x.p.name}: ${fmt(x.c.winrate, 0)} % en ${x.c.games}`).join('\n');
    return h('div', { class: 'own', title: `${e.key} · ${e.total} partidas en el grupo\n${e.owner.p.name}: ${fmt(e.owner.c.winrate, 0)} % en ${e.owner.c.games}${others ? `\n${others}` : ''}` },
      h('div', { class: 'own-ic' }, champIcon(e.key, 52), h('span', { class: 'own-av' }, avatar(e.owner.p, 22))),
      h('b', {}, e.key),
      h('small', {}, h('span', { class: e.owner.c.winrate >= 50 ? 'pos' : 'neg' }, `${fmt(e.owner.c.winrate, 0)} %`), ` · ${e.owner.c.games}p · ${e.owner.p.name}`));
  });

  // Pool de cada uno
  const pool = rows.map((p) => {
    const cs = p.s.champs;
    const total = cs.reduce((s, c) => s + c.games, 0);
    const top3 = cs.slice(0, 3).reduce((s, c) => s + c.games, 0);
    return { p, n: cs.length, used: cs.filter((c) => c.games >= 5).length, top3: total ? (top3 / total) * 100 : 0, top: cs[0], total };
  }).sort((a, b) => b.top3 - a.top3);

  // Némesis: rival directo de línea contra el que peor (y mejor) le va
  const vsList = (p) => Object.entries(p.s.vs ?? {}).map(([champ, [n, w]]) => ({ champ, n, w, adj: adjWr(w, n, 3) }));
  const nem = rows.map((p) => {
    const l = vsList(p).filter((x) => x.n >= 4);
    const worst = l.length ? l.reduce((m, x) => (x.adj < m.adj ? x : m)) : null;
    const best = l.length ? l.reduce((m, x) => (x.adj > m.adj ? x : m)) : null;
    return { p, worst, best };
  });
  const groupVs = new Map();
  for (const p of rows) {
    for (const x of vsList(p)) {
      const e = groupVs.get(x.champ) ?? { champ: x.champ, n: 0, w: 0 };
      e.n += x.n; e.w += x.w;
      groupVs.set(x.champ, e);
    }
  }
  const gWorst = [...groupVs.values()].filter((e) => e.n >= 10).sort((a, b) => adjWr(a.w, a.n, 5) - adjWr(b.w, b.n, 5)).slice(0, 8);
  const vsTxt = (x) => `${x.w}V ${x.n - x.w}D · ${fmt(pct(x.w, x.n), 0)} %`;

  box.replaceChildren(
    h('h3', { class: 'aw-sub' }, 'El dueño de cada campeón'),
    h('p', { class: 'muted small' }, 'Quién lo juega mejor del grupo (winrate ajustado, mínimo 5 partidas) · pasa el ratón para ver al resto'),
    h('div', { class: 'owns' }, tiles),
    owned.length > 24 ? h('div', { class: 'center' }, h('button', { class: 'ghost-btn', onclick: () => { champsShowAll = !champsShowAll; renderChampsGroup(); } }, champsShowAll ? 'Ver menos ↑' : `Ver los ${owned.length} →`)) : null,
    h('h3', { class: 'aw-sub' }, 'El pool de cada uno'),
    h('div', { class: 'pool' }, pool.map((x) => h('div', { class: 'pool-row' },
      avatar(x.p, 28), h('b', { class: 'pool-name' }, x.p.name),
      h('span', { class: 'pool-n', title: 'Campeones distintos esta temporada (con 5 o más partidas)' }, h('b', {}, x.n), ` campeones · ${x.used} con 5+ partidas`),
      h('div', { class: 'pool-bar', title: `El ${fmt(x.top3, 0)} % de sus partidas son con sus 3 más jugados` },
        h('i', { style: `width:${x.top3}%` }), h('span', {}, `${fmt(x.top3, 0)} % con su top 3`)),
      x.top ? h('span', { class: 'pool-top' }, champIcon(x.top.key, 26), h('small', {}, `${x.top.games}p`)) : null))),
    h('h3', { class: 'aw-sub' }, 'Némesis y presas'),
    h('p', { class: 'muted small' }, 'Contra el rival directo de línea · mínimo 4 partidas · el que más te gana es buen candidato a ban'),
    h('div', { class: 'nems' }, nem.map(({ p, worst, best }) => h('div', { class: 'nem' },
      h('div', { class: 'nem-who' }, avatar(p, 28), h('b', {}, p.name)),
      h('div', { class: 'nem-pair' },
        worst ? h('div', { class: 'nem-c bad', title: 'Buen candidato a ban' }, champIcon(worst.champ, 34), h('div', {}, h('small', {}, 'Te gana'), h('b', {}, worst.champ), h('span', {}, vsTxt(worst)))) : h('span', { class: 'muted small' }, 'Pocos datos'),
        best && best !== worst ? h('div', { class: 'nem-c good' }, champIcon(best.champ, 34), h('div', {}, h('small', {}, 'Le ganas'), h('b', {}, best.champ), h('span', {}, vsTxt(best)))) : null)))),
    gWorst.length ? h('h3', { class: 'aw-sub' }, 'Los que más os ganan') : null,
    gWorst.length ? h('div', { class: 'gnem' }, gWorst.map((e) => h('div', { class: 'gnem-c', title: `Contra ${e.champ} en vuestra línea: ${e.w}V ${e.n - e.w}D` },
      champIcon(e.champ, 40), h('b', {}, e.champ), h('span', { class: pct(e.w, e.n) < 50 ? 'neg' : 'pos' }, `${fmt(pct(e.w, e.n), 0)} %`), h('small', { class: 'muted' }, `${e.n} partidas`)))) : null);
}

// ---------------------------------------------------------------- comparador
const CMP_STATS = [
  ['Winrate', (p) => p.rank?.winrate, (v) => `${fmt(v, 1)}%`],
  ['KDA', (p) => p.s?.kda, (v) => fmt(v, 2)],
  ['Kills / partida', (p) => p.s?.avgK, (v) => fmt(v, 1)],
  ['Muertes / partida', (p) => p.s?.avgD, (v) => fmt(v, 1), 'low'],
  ['Asistencias / partida', (p) => p.s?.avgA, (v) => fmt(v, 1)],
  ['Participación en kills', (p) => p.s?.avgKp, (v) => `${v}%`],
  ['CS / min', (p) => p.s?.csPerMin, (v) => fmt(v, 1)],
  ['Daño / min', (p) => p.s?.dmgPerMin, (v) => fmtInt(v)],
  ['% del daño del equipo', (p) => p.s?.dmgShare, (v) => `${fmt(v, 1)}%`],
  ['Visión / min', (p) => p.s?.visPerMin, (v) => fmt(v, 2)],
  ['Oro @15 vs rival', (p) => p.s?.gold?.avgGd15, (v) => goldK(v)],
  ['First bloods', (p) => p.s?.firstBloods, (v) => v],
  ['Pentakills', (p) => p.s?.pentas, (v) => v],
  ['LP por victoria', (p) => p.s?.lp?.win, (v) => `+${v}`],
  ['LP por derrota', (p) => p.s?.lp?.loss, (v) => `${v}`],
  ['1ª partida del día', (p) => (p.s?.firstOfDay?.games >= 10 ? p.s.firstOfDay.winrate : null), (v) => `${fmt(v, 0)}%`],
  ['Mejor racha', (p) => p.s?.streak?.bestWin, (v) => `${v}V`],
  ['Peor racha', (p) => p.s?.streak?.worstLoss, (v) => `${v}D`, 'low'],
  ['Partidas de la temporada', (p) => p.wins + p.losses, (v) => fmtInt(v), 'none'],
];
const CMP_COLORS = ['#3987e5', '#d95926'];

function pairEloChart(A, B) {
  const box = h('div', { class: 'chart cmp-chart' });
  const series = [A, B].map((p, i) => {
    const { est, real } = eloSeries(p.main);
    const pts = [...est.map((x) => [x[0], x[1], 1]), ...real.map((x) => [x[0], x[1], 0])].sort((a, b) => a[0] - b[0]);
    if (p.score >= 0) pts.push([Date.now(), p.score, 0]);
    return { p, pts, color: CMP_COLORS[i] };
  });
  requestAnimationFrame(() => {
    const W = Math.max(300, box.clientWidth), H = 220, L = 58, R = 12, T = 12, Bm = 24;
    const now = Date.now(), t0 = now - 30 * 864e5;
    const vis = series.map((s) => {
      const before = s.pts.filter((q) => q[0] <= t0).at(-1);
      return { ...s, pts: [...(before ? [[t0, before[1], before[2]]] : []), ...s.pts.filter((q) => q[0] > t0)] };
    }).filter((s) => s.pts.length);
    if (!vis.length) { box.replaceChildren(h('p', { class: 'empty' }, 'Sin datos de elo.')); return; }
    let lo = Math.min(...vis.flatMap((s) => s.pts.map((q) => q[1]))), hi = Math.max(...vis.flatMap((s) => s.pts.map((q) => q[1])));
    lo = Math.max(0, Math.floor((lo - 20) / 100) * 100); hi = Math.ceil((hi + 20) / 100) * 100;
    const x = (t) => L + ((t - t0) / (now - t0)) * (W - L - R);
    const y = (v) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - Bm);
    const els = [];
    const step = hi - lo > 900 ? 400 : hi - lo > 300 ? 200 : 100;
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      els.push(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }));
      els.push(svg('text', { x: L - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, v >= 2800 ? `M ${v - 2800}` : `${TIER_ES[TIERS[Math.floor(v / 400)]].slice(0, 3)} ${DIVS[Math.floor((v % 400) / 100)]}`));
    }
    for (let k = 0; k < 4; k++) {
      const t = t0 + ((now - t0) * k) / 3;
      els.push(svg('text', { x: x(t), y: H - 6, class: 'axis', 'text-anchor': k === 0 ? 'start' : k === 3 ? 'end' : 'middle' }, prettyDay(dayKey(t))));
    }
    for (const s of vis) {
      const d = s.pts.map((q, i) => `${i ? 'L' : 'M'}${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join('');
      els.push(svg('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      const last = s.pts.at(-1);
      els.push(svg('circle', { cx: x(last[0]), cy: y(last[1]), r: 4, fill: s.color }));
    }
    box.replaceChildren(svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Elo de los dos en los últimos 30 días' }, ...els));
  });
  return box;
}

function compareView(A, B) {
  let sa = 0, sb = 0;
  const rows = CMP_STATS.map(([label, get, f, mode]) => {
    const a = get(A), b = get(B);
    if (a == null && b == null) return null;
    let win = 0;
    if (mode !== 'none' && a != null && b != null && a !== b) win = (mode === 'low' ? a < b : a > b) ? -1 : 1;
    if (win < 0) sa++; else if (win > 0) sb++;
    // Barras: el que gana, entera; el otro, en proporción (a media si hay valores negativos)
    const share = (x, y) => (x == null || (!x && !y) ? 0 : Math.abs(x) / Math.max(Math.abs(x), Math.abs(y ?? 0)));
    let wa = share(a, b), wb = share(b, a);
    if (win) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const loser = lo < 0 || hi <= 0 ? 0.5 : lo / hi;
      wa = win < 0 ? 1 : loser;
      wb = win > 0 ? 1 : loser;
    }
    return h('div', { class: 'cmp-row' },
      h('b', { class: `cmp-v ${win < 0 ? 'win' : ''}` }, a == null ? '–' : f(a)),
      h('div', { class: 'cmp-bar l' }, h('i', { style: `width:${wa * 100}%;background:${CMP_COLORS[0]};opacity:${win < 0 ? 1 : 0.45}` })),
      h('span', { class: 'cmp-l' }, label),
      h('div', { class: 'cmp-bar r' }, h('i', { style: `width:${wb * 100}%;background:${CMP_COLORS[1]};opacity:${win > 0 ? 1 : 0.45}` })),
      h('b', { class: `cmp-v ${win > 0 ? 'win' : ''}` }, b == null ? '–' : f(b)));
  }).filter(Boolean);
  const diff = A.score >= 0 && B.score >= 0 ? A.score - B.score : null;
  const lead = diff == null ? '' : diff === 0 ? 'Empatados en elo' : `${diff > 0 ? A.name : B.name} va ${Math.abs(diff)} LP por encima`;
  const side = (p, i) => h('div', { class: `cmp-side s${i}` }, avatar(p, 54, 'big'), h('b', {}, p.name),
    h('span', { class: 'cmp-rank' }, crest(p.rank, 26), h('span', { class: `t-${tierKey(p.rank)}` }, rankName(p.rank)), p.rank ? h('small', {}, ` ${p.rank.lp} LP`) : null),
    h('span', { class: 'cmp-score' }, `${i ? sb : sa}`));
  // Roles
  const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
  const roleBar = (p) => {
    const br = p.s?.byRole ?? {};
    const counts = ROLES.map((r) => br[r]?.games ?? 0);
    const shares = pct100(counts);
    return h('div', { class: 'cmp-roles' }, h('b', {}, p.name),
      h('div', { class: 'rs-bar' }, ROLES.map((r, i) => (counts[i] ? h('i', { style: `flex:${counts[i]};background:${ROLE_COLOR[r]}`, title: `${ROLE_ES[r]}: ${shares[i]}%` }) : null))),
      h('div', { class: 'cmp-role-l' }, ROLES.map((r, i) => (shares[i] >= 8 ? h('span', {}, roleIcon(r), `${shares[i]}%`) : null))));
  };
  // Campeones en común
  const ca = new Map((A.s?.champs ?? []).map((c) => [c.key, c])), cb = new Map((B.s?.champs ?? []).map((c) => [c.key, c]));
  const common = [...ca.keys()].filter((k) => cb.has(k) && ca.get(k).games >= 3 && cb.get(k).games >= 3)
    .sort((x, y) => ca.get(y).games + cb.get(y).games - ca.get(x).games - cb.get(x).games).slice(0, 8);
  // Juntos y en contra
  const duo = (DATA.duos ?? []).find((d) => (d.a === A.name && d.b === B.name) || (d.a === B.name && d.b === A.name));
  const riv = (DATA.rivals ?? []).find((d) => (d.a === A.name && d.b === B.name) || (d.a === B.name && d.b === A.name));
  const rivTxt = riv ? (riv.a === A.name ? `${riv.aWins}–${riv.bWins}` : `${riv.bWins}–${riv.aWins}`) : null;
  return [
    h('div', { class: 'cmp-top' }, side(A, 0), h('div', { class: 'cmp-mid' }, h('b', { class: 'cmp-vs' }, 'VS'), h('small', {}, lead),
      h('small', { class: 'muted' }, `${sa} a ${sb} en estadísticas`)), side(B, 1)),
    h('div', { class: 'cmp-h2h' },
      duo ? h('span', {}, '🤝 Juntos: ', h('b', {}, `${plural(duo.games, 'partida')} · ${duo.wins}V ${duo.losses}D (${fmt(duo.wr, 0)} %)`)) : h('span', { class: 'muted' }, '🤝 No han jugado juntos esta temporada'),
      rivTxt ? h('span', {}, '⚔️ Cara a cara: ', h('b', {}, rivTxt)) : null),
    h('div', { class: 'cmp-rows' }, rows),
    h('h4', { class: 'sx-h' }, 'Elo en los últimos 30 días'),
    h('div', { class: 'cmp-legend' }, [A, B].map((p, i) => h('span', {}, h('i', { style: `background:${CMP_COLORS[i]}` }), p.name))),
    pairEloChart(A, B),
    h('h4', { class: 'sx-h' }, 'Roles'),
    h('div', { class: 'cmp-roles-wrap' }, roleBar(A), roleBar(B)),
    common.length ? h('h4', { class: 'sx-h' }, 'Campeones que juegan los dos') : null,
    common.length ? h('div', { class: 'cmp-champs' }, common.map((k) => {
      const a = ca.get(k), b = cb.get(k);
      return h('div', { class: 'cmp-ch' },
        h('span', { class: a.winrate >= b.winrate ? 'pos' : '' }, `${fmt(a.winrate, 0)}%`, h('small', {}, ` (${a.games})`)),
        champIcon(k, 34),
        h('span', { class: b.winrate > a.winrate ? 'pos' : '' }, `${fmt(b.winrate, 0)}%`, h('small', {}, ` (${b.games})`)));
    })) : null,
  ];
}

function openCompare(aName, bName) {
  if (!MODEL.length) return;
  const players = [...MODEL].sort(SORTERS.rank);
  let A = MODEL.find((p) => p.name === aName) ?? players[0];
  let B = MODEL.find((p) => p.name === bName && p !== A) ?? players.find((p) => p !== A);
  const body = h('div', { class: 'cmp' });
  const sel = (cur, onChange) => h('select', { class: 'cmp-sel', onchange: (e) => onChange(MODEL.find((p) => p.name === e.target.value)) },
    players.map((p) => h('option', { value: p.name, selected: p === cur }, p.name)));
  let selA, selB;
  const draw = () => {
    history.replaceState(null, '', `#vs/${encodeURIComponent(A.name)}/${encodeURIComponent(B.name)}`);
    selA.value = A.name; selB.value = B.name;
    body.replaceChildren(...compareView(A, B).filter(Boolean));
  };
  selA = sel(A, (p) => { if (p === B) B = A; A = p; draw(); });
  selB = sel(B, (p) => { if (p === A) A = B; B = p; draw(); });
  const linkBtn = h('button', { class: 'ghost-btn', onclick: () => copyText(location.href, linkBtn, '¡Enlace copiado!') }, '🔗 Copiar enlace');
  const bar = h('div', { class: 'cmp-bar-top' }, selA, h('button', { class: 'cmp-swap', title: 'Intercambiar', onclick: () => { [A, B] = [B, A]; draw(); } }, '⇄'), selB, linkBtn);
  openModal('Comparar jugadores', h('div', { class: 'cmp-wrap' }, bar, body), { wide: true, head: h('b', {}, '⚖ Comparar jugadores') });
  draw();
}

// ---------------------------------------------------------------- menú "Más", instalar la app y enlaces directos
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });

function installApp() {
  if (installEvt) {
    installEvt.prompt();
    installEvt.userChoice.finally(() => { installEvt = null; });
    return;
  }
  const P = (...c) => h('p', {}, ...c);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  openModal('Instalar la app', h('div', { class: 'info-body' },
    standalone ? P('Ya la estás usando como app 👌')
      : ios ? [P('En el iPhone se instala desde Safari:'), h('ol', {}, h('li', {}, 'Pulsa el botón ', h('b', {}, 'Compartir'), ' (el cuadrado con la flecha).'),
        h('li', {}, 'Elige ', h('b', {}, 'Añadir a pantalla de inicio'), '.'), h('li', {}, 'Pulsa ', h('b', {}, 'Añadir'), '.'))]
      : [P('En Android, abre el menú del navegador (⋮) y pulsa ', h('b', {}, 'Instalar aplicación'), ' o ', h('b', {}, 'Añadir a pantalla de inicio'), '.'),
        P('En el ordenador (Chrome o Edge), usa el icono de instalar de la barra de direcciones.')],
    P(h('span', { class: 'muted' }, 'Se abre a pantalla completa, con el icono de SoloQ Crew, y si no hay conexión enseña los últimos datos.'))));
}

function wireMore() {
  const btn = document.getElementById('more-btn');
  const menu = document.getElementById('more-menu');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btn.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  menu.addEventListener('click', (e) => {
    const el = e.target.closest('a,button');
    if (!el) return;
    if (el.dataset.action === 'compare') openCompare();
    if (el.dataset.action === 'install') installApp();
    if (el.dataset.action === 'desktop') toggleDesktop();
    close();
  });
  // Vista de ordenador: solo tiene sentido en pantallas pequeñas (o si ya está activada)
  const desk = document.getElementById('desktop-btn');
  const on = desktopOn();
  desk.hidden = !on && !chromeDesktopForced() && Math.min(screen.width, screen.height) > 820 && screen.width > 1024;
  desk.textContent = on || chromeDesktopForced() ? '📱 Volver a la vista de móvil' : '🖥️ Vista de ordenador';
}

function desktopOn() {
  try { return localStorage.getItem('sq-desktop') === '1'; } catch { return false; }
}
// Chrome con "Sitio de escritorio" activado se presenta como un ordenador (sin "Android" ni "Mobile") aunque sea
// un móvil táctil. En ese modo Chrome ignora el tamaño que pide la web, así que este botón no puede quitarlo.
function chromeDesktopForced() {
  return navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 600
    && !/Android|Mobile|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
// Como "Sitio de escritorio" de Chrome, pero dentro de la web: funciona también con la app instalada
function toggleDesktop() {
  if (chromeDesktopForced()) {
    try { localStorage.removeItem('sq-desktop'); } catch { /* nada */ }
    const P = (...c) => h('p', {}, ...c);
    openModal('Vista de móvil', h('div', { class: 'info-body' },
      P('Ahora mismo la vista de ordenador la ha puesto ', h('b', {}, 'Chrome'), ' (su ajuste «Sitio de escritorio») y manda sobre este botón, también dentro de la app instalada. Para quitarla:'),
      h('ol', {},
        h('li', {}, 'Abre Chrome, el navegador normal, y pulsa ', h('b', {}, '⋮ → Configuración'), '.'),
        h('li', {}, 'Entra en ', h('b', {}, 'Configuración de sitios → Sitio de escritorio'), ' (puede llamarse «Versión para ordenador»).'),
        h('li', {}, 'Déjalo en ', h('b', {}, 'Vista predeterminada'), ' o quita la excepción de ', h('b', {}, 'xalozz.github.io'), '.')),
      P('Luego cierra la app y vuelve a abrirla. A partir de ahí este botón cambia entre las dos vistas.')));
    return;
  }
  const on = !desktopOn();
  try {
    if (on) localStorage.setItem('sq-desktop', '1'); else localStorage.removeItem('sq-desktop');
    location.reload();
  } catch {
    // Sin almacenamiento: se aplica solo a esta visita
    document.querySelector('meta[name=viewport]').setAttribute('content', on ? `width=1280, initial-scale=${Math.min(1, screen.width / 1280).toFixed(3)}` : 'width=device-width, initial-scale=1, viewport-fit=cover');
  }
}

// #partida/<id> abre una partida (enlaces de Discord) · #vs/<a>/<b> abre el comparador
function handleHash() {
  let hash = location.hash;
  try { hash = decodeURIComponent(hash); } catch { /* tal cual */ }
  let m;
  if ((m = hash.match(/^#partida\/(.+)$/))) {
    const id = m[1];
    const e = (DATA.events ?? []).find((x) => x.gameId === id);
    const p = e ? MODEL.find((q) => q.name === e.name) : MODEL.find((q) => (q.main?.recent ?? []).some((g) => g.id === id));
    openMatchModal(id, e ? evParts(e)[1] : 'Partida', p?.main?.riotId);
  } else if ((m = hash.match(/^#vs\/([^/]+)\/(.+)$/))) {
    if (!document.querySelector('.cmp')) openCompare(m[1], m[2]);
  }
}

// ---------------------------------------------------------------- render
let MODEL = [];

function renderRows() {
  applyPeriod(MODEL);
  const label = `LP ${PERIODS[period].short}`;
  document.getElementById('th-period').textContent = label;
  document.getElementById('sort-period').textContent = label;
  const q = query.trim().toLowerCase();
  const list = [...MODEL].sort(SORTERS[sortKey])
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.accounts.some((a) => a.riotId.toLowerCase().includes(q)));
  const box = document.getElementById('rows');
  box.closest('.table').dataset.sort = sortKey;
  box.replaceChildren(...(list.length ? list.map(row) : [h('p', { class: 'empty' }, 'Ningún jugador coincide con la búsqueda.')]));
}

function renderMeta() {
  if (!DATA) return;
  const ago = timeAgo(DATA.generatedAt);
  const checked = STATUS?.at && !STATUS.err ? timeAgo(new Date(STATUS.at).toISOString()) : null;
  document.getElementById('updated').textContent = checked ? `Comprobado ${checked}` : `Actualizado ${ago}`;
  document.getElementById('refresh').title = `Última novedad en los datos: ${ago}${checked ? ` · comprobado ${checked}` : ''} · se recarga sola cada minuto`;
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
    ...STAT_CARDS.map((d) => statCard(d, MODEL)).filter(Boolean), kdaCard(MODEL) ?? '', rolesCard(MODEL) ?? '');
  renderBest5(MODEL);
  requestAnimationFrame(() => renderGroupElo(MODEL));
  renderDuos(MODEL);
  renderAwards(MODEL);
  renderDays(MODEL);
  renderRecords(MODEL);
  // Cada sección nueva va aparte: si una falla, el resto de la web se sigue viendo
  for (const fn of [renderLive, renderBanner, renderEvents, renderWeek, renderChallenges, renderFlex, renderTilt, renderChampsGroup]) {
    try { fn(); } catch (err) { console.error(fn.name, err); }
  }
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
  document.getElementById('period').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-period]');
    if (!b) return;
    period = b.dataset.period;
    for (const x of e.currentTarget.children) x.classList.toggle('on', x === b);
    sortKey = 'period';
    for (const x of document.getElementById('sort').children) x.classList.toggle('on', x.dataset.sort === 'period');
    renderRows();
  });
  document.getElementById('compare-btn').addEventListener('click', () => openCompare());
  document.getElementById('week-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-week]');
    if (!b) return;
    weekTab = b.dataset.week;
    renderWeek();
  });
  wireMore();
  setInterval(tickLive, 30_000);
  document.getElementById('best5-info').addEventListener('click', best5Info);
  document.getElementById('ge-range').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-days]');
    if (!b) return;
    geDays = Number(b.dataset.days);
    for (const x of e.currentTarget.children) x.classList.toggle('on', x === b);
    renderGroupElo(MODEL);
  });
  document.getElementById('ge-all').addEventListener('click', () => { geHidden.clear(); renderGroupElo(MODEL); });
  document.getElementById('ge-none').addEventListener('click', () => { for (const p of DATA.players) geHidden.add(p.name); renderGroupElo(MODEL); });
  let geT; window.addEventListener('resize', () => { clearTimeout(geT); geT = setTimeout(() => MODEL.length && renderGroupElo(MODEL), 150); });
  document.getElementById('best5-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    best5Mode = b.dataset.mode;
    renderBest5(MODEL);
  renderAwards(MODEL);
  });
  document.getElementById('days-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    daysMode = b.dataset.mode;
    for (const x of e.currentTarget.children) x.classList.toggle('on', x === b);
    renderDays(MODEL);
  });
  // Enlace activo del menú según la sección visible (las del menú "Más" marcan el botón "Más")
  const links = [...document.querySelectorAll('.nav-links a')];
  const moreIds = new Set([...document.querySelectorAll('#more-menu a')].map((a) => a.getAttribute('href')));
  const moreBtn = document.getElementById('more-btn');
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const id = `#${en.target.id}`;
      links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === id));
      moreBtn.classList.toggle('active', moreIds.has(id));
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('main section[id]').forEach((s) => io.observe(s));
  setInterval(() => DATA && renderMeta(), 60_000);
}

// Recarga de datos: automática cada minuto y con el botón ↻ (mantiene lo que tengas desplegado)
let refreshing = false;
async function refreshData(manual = false) {
  if (refreshing || document.hidden && !manual) return;
  refreshing = true;
  const btn = document.getElementById('refresh');
  btn?.classList.add('spin');
  try {
    const res = await fetch(`data/data.json?t=${Date.now()}`);
    if (res.ok) {
      const fresh = await res.json();
      if (!DATA || fresh.generatedAt !== DATA.generatedAt) {
        DATA = fresh;
        WEEKS = null;
        detailCache.clear();
        render();
      } else renderMeta();
    }
  } catch { /* sin conexión: se reintenta en el siguiente minuto */ }
  setTimeout(() => btn?.classList.remove('spin'), 400);
  refreshing = false;
}

// Estado del actualizador automático. Cada minuto deja un "latido" en la rama heartbeat;
// el mensaje del latido lleva el resultado de la pasada: si Riot respondió, si la clave vale y quién está jugando.
async function checkLive() {
  const el = document.getElementById('live');
  if (!el || document.hidden) return;
  const set = (cls, text, title) => { el.className = `live ${cls}`; el.querySelector('span').textContent = text; el.title = title; };
  const prevLive = JSON.stringify(LIVE);
  try {
    const r = await fetch('https://api.github.com/repos/xalozz/soloq-crew/commits/heartbeat', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    const beat = new Date(j.commit.committer.date).getTime();
    const msg = j.commit.message ?? '';
    const i = msg.indexOf('\n\n');
    let st = null;
    if (i >= 0) { try { st = JSON.parse(msg.slice(i + 2).trim()); } catch { st = null; } }
    STATUS = { ...(st ?? {}), beat };
    const mins = Math.round((Date.now() - beat) / 60000);
    const fresh = mins <= 4;
    LIVE = fresh && Array.isArray(st?.live) ? st.live : [];
    const checked = st?.at ? Math.round((Date.now() - st.at) / 60000) : mins;
    const agoMin = (m) => (m <= 0 ? 'hace menos de 1 min' : `hace ${m} min`);
    if (!fresh) set('off', 'Parado', `Sin latido desde hace ${mins} min. Se relanza solo; si dura mucho, avisa`);
    else if (st?.err === 'key') set('off', 'Clave caducada', 'Riot rechaza la clave de la API: los datos no se actualizan hasta renovarla (secreto RIOT_API_KEY en GitHub)');
    else if (st?.err) set('warn', 'Riot no responde', `La última comprobación falló${st.msg ? ` (${st.msg})` : ''}. Se reintenta cada minuto`);
    else if (st?.at && checked > 10) set('warn', 'Con retraso', `La última comprobación correcta fue ${agoMin(checked)}`);
    else {
      set('on', 'En directo', `Comprobado ${agoMin(checked)} · última novedad ${DATA ? timeAgo(DATA.generatedAt) : '–'}`
        + `${st?.accErr?.length ? ` · sin actualizar: ${st.accErr.join(', ')}` : ''}`);
    }
  } catch {
    set('unk', 'Estado ?', 'No se ha podido comprobar el estado (pulsa para verlo en GitHub)');
  }
  renderMeta();
  if (JSON.stringify(LIVE) !== prevLive && MODEL.length) { renderLive(); renderRows(); }
}

async function init() {
  wire();
  // App instalable y con los últimos datos sin conexión
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  setInterval(checkLive, 2 * 60_000);
  document.getElementById('refresh').addEventListener('click', () => { refreshData(true); checkLive(); });
  setInterval(() => refreshData(false), 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshData(false); checkLive(); } });
  window.addEventListener('hashchange', () => DATA && handleHash());
  try {
    const res = await fetch(`data/data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    DATA = await res.json();
  } catch {
    document.getElementById('rows').replaceChildren(h('p', { class: 'empty' }, 'Todavía no hay datos. Aparecerán tras la primera actualización automática.'));
    return;
  }
  render();
  checkLive();
  handleHash();
}

init();

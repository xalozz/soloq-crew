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
            h('div', { class: 'md-name' }, h('b', { title: p.rid }, p.rid), h('span', {}, h('span', {}, p.k), ' / ', h('span', { class: 'neg' }, p.d), ' / ', h('span', {}, p.a),
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

// Ventana con el detalle de una partida (desde los récords)
function openMatchModal(id, title, meRiotId) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const ov = h('div', { class: 'modal', onclick: (e) => { if (e.target === ov) close(); } },
    h('div', { class: 'modal-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('b', {}, title), h('button', { class: 'modal-x', onclick: close, 'aria-label': 'Cerrar' }, '×')),
      matchDetailView(id, meRiotId)));
  document.addEventListener('keydown', onKey);
  document.body.append(ov);
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

function eloChart(acc) {
  const box = h('div', { class: 'chart' });
  const ser = eloSeries(acc);
  if (ser.est.length < 2 && ser.real.length < 2) {
    box.append(h('p', { class: 'empty' }, 'Todavía no hay partidas suficientes para dibujar la evolución.'));
    return box;
  }
  requestAnimationFrame(() => drawEloChart(box, ser));
  return box;
}

function drawEloChart(box, { est, real, W, L, measured }) {
  const Wd = Math.max(300, box.clientWidth), H = 240, Lm = 64, R = 14, T = 14, B = 26;
  // Un punto por partida (o por cambio de LP registrado), en orden: se lee como la curva de un torneo
  const pts = [...est.map((p) => [p[0], p[1], true]), ...real.map((p) => [p[0], p[1], false])]
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, arr) => i === 0 || p[1] !== arr[i - 1][1] || p[2] !== arr[i - 1][2]);
  if (pts.length < 2) pts.push([Date.now(), pts[0][1], false]);
  const n = pts.length;
  let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
  lo = Math.max(0, Math.floor((lo - 15) / 100) * 100); hi = Math.ceil((hi + 15) / 100) * 100;
  const x = (i) => Lm + (i / Math.max(1, n - 1)) * (Wd - Lm - R);
  const y = (v) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const els = [];
  const span = hi - lo;
  const step = span > 2400 ? 800 : span > 700 ? 400 : 100;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    els.push(svg('line', { x1: Lm, x2: Wd - R, y1: y(v), y2: y(v), class: 'grid' }));
    const lab = v >= 2800 ? `M ${v - 2800}` : `${TIER_ES[TIERS[Math.floor(v / 400)]].slice(0, 3)} ${DIVS[Math.floor((v % 400) / 100)]}`;
    els.push(svg('text', { x: Lm - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, lab));
  }
  const nTicks = Math.max(2, Math.min(6, Math.floor((Wd - Lm) / 110)));
  const seen = new Set();
  for (let k = 0; k < nTicks; k++) {
    const i = Math.round(((n - 1) * k) / (nTicks - 1));
    const key = dayKey(pts[i][0]);
    if (seen.has(key)) continue;
    seen.add(key);
    els.push(svg('text', { x: x(i), y: H - 6, class: 'axis', 'text-anchor': k === 0 ? 'start' : k === nTicks - 1 ? 'end' : 'middle' }, prettyDay(key)));
  }
  // Tramo estimado (discontinuo) y registrado (continuo); comparten el punto de unión
  const lastEst = pts.map((p) => p[2]).lastIndexOf(true);
  const line = (from, to, cls) => {
    if (to - from < 1) return;
    const d = pts.slice(from, to + 1).map((p, j) => `${j ? 'L' : 'M'}${x(from + j).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
    els.push(svg('path', { d, class: cls }));
  };
  if (lastEst >= 0) line(0, Math.min(n - 1, lastEst + 1), 'eline est');
  line(Math.max(0, lastEst + 1), n - 1, 'eline');
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
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    tip.hidden = false;
    tip.replaceChildren(
      h('b', {}, new Date(p[0]).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ })),
      h('span', {}, `${p[2] ? '≈ ' : ''}${scoreLabel(p[1])}`),
      p[2] ? h('small', {}, 'estimado') : null);
    tip.style.left = `${(x(i) / Wd) * 100}%`;
    tip.style.top = `${(y(p[1]) / H) * 100}%`;
  });
  chart.addEventListener('pointerleave', () => { tip.hidden = true; dot.setAttribute('cx', -20); cross.setAttribute('x1', -20); cross.setAttribute('x2', -20); });
  const legend = h('div', { class: 'elegend' },
    lastEst >= 0 ? h('span', {}, h('i', { class: 'lg est' }), `Estimado con sus victorias y derrotas (≈ +${W} / −${L} LP por partida${measured ? ', medidos' : ''})`) : null,
    real.length ? h('span', {}, h('i', { class: 'lg' }), 'LP registrado') : null,
    h('span', { class: 'lg-note' }, `${n} puntos · uno por partida`));
  box.replaceChildren(chart, tip, legend);
}

function tabStats(acc) {
  const s = acc.stats, r = acc.rank;
  const next = nextDivision(r);
  const peak = acc.lpHist?.length ? Math.max(...acc.lpHist.map((x) => x[1])) : rankScore(r);
  const lp = s?.lp;
  return h('div', { class: 'sx' },
    h('div', { class: 'sx-rank', style: `border-left-color: var(--t-${tierKey(r)})` },
      h('div', { class: 'sx-tier' }, crest(r, 54), h('div', {}, h('b', { class: `t-${tierKey(r)}` }, rankName(r)), h('span', {}, r ? `${r.lp} LP` : 'Sin partidas de clasificación'))),
      r ? h('div', { class: 'sx-wr' }, h('span', { class: 'lbl' }, 'Winrate'), winBar(r.wins, r.losses)) : null),
    next ? h('div', { class: 'sx-prog' },
      h('div', { class: 'sx-prog-top' }, h('span', {}, `Hacia ${next}`), h('b', {}, `${r.lp} / 100 LP`)),
      h('div', { class: 'sx-prog-bar' }, h('i', { style: `width:${Math.min(100, r.lp)}%` }))) : null,
    s ? h('div', { class: 'sx-kda' },
      h('div', {}, h('b', { class: 'big' }, fmt(s.kda, 2)), h('span', { class: 'lbl' }, 'KDA')),
      s.totals ? h('div', { class: 'sx-tot' }, h('span', { class: 'pos' }, fmtInt(s.totals.k)), ' / ', h('span', { class: 'neg' }, fmtInt(s.totals.d)), ' / ', h('span', { class: 'blue' }, fmtInt(s.totals.a))) : null,
      h('div', { class: 'sx-reg' }, h('b', {}, s.games), h('span', { class: 'lbl' }, 'Partidas analizadas'))) : null,
    s ? h('div', { class: 'tiles t3' },
      tile('CS / min', fmt(s.csPerMin)), tile('Daño / min', s.dmgPerMin != null ? fmtInt(s.dmgPerMin) : '–'), tile('Visión', fmt(s.avgVision ?? null))) : null,
    s ? h('div', { class: 'tiles t3' },
      tile('Pentakills', s.pentas ?? '–'), tile('First bloods', s.firstBloods ?? '–', 'warm'), tile('Récord de kills', s.maxKills ?? '–', 'cool')) : null,
    s ? h('div', { class: 'tiles t3' },
      tile('KP media', s.avgKp != null ? `${s.avgKp}%` : '–'),
      tile('LP por victoria / derrota', lp && (lp.winN || lp.lossN) ? h('span', {}, h('span', { class: 'pos' }, lp.win != null ? `▲${lp.win}` : '–'), '  ', h('span', { class: 'neg' }, lp.loss != null ? `▼${Math.abs(lp.loss)}` : '–')) : h('span', { class: 'muted', title: 'Se calcula con las partidas jugadas desde que se registra el LP' }, 'Pronto')),
      tile('Racha actual · mejor · peor', h('span', {}, streakChip(s), ` ${s.streak.bestWin}V · ${s.streak.worstLoss}D`))) : null,
    s?.gold ? h('div', { class: 'tiles t3' },
      tile('Oro @15 vs rival (media)', h('span', { class: (s.gold.avgGd15 ?? 0) >= 0 ? 'pos' : 'neg' }, goldK(s.gold.avgGd15))),
      tile('Mayor ventaja de oro', s.gold.biggestLead ? goldK(s.gold.biggestLead.val) : '–', 'cool'),
      tile(`Mayor throw · ${s.gold.throws} partidas lanzadas`, s.gold.biggestThrow ? h('span', { class: 'neg' }, goldK(s.gold.biggestThrow.val)) : '–', 'hot')) : null,
    s ? h('p', { class: 'sx-line' },
      'Duración media ', h('b', {}, `${fmt(s.avgDurationMin)} min`), ' · Más larga ', h('b', {}, `${fmt(s.maxDurationMin ?? null)} min`),
      ' · Pico ', h('b', { class: `t-${tierKey(r)}` }, peak >= 0 ? scoreLabel(peak) : '–')) : null,
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
    ['Mejor racha registrada', pick(rows, (r) => r.s.streak.bestWin), (r) => `${r.s.streak.bestWin} victorias`, 'good'],
    ['Peor racha registrada', pick(rows, (r) => r.s.streak.worstLoss), (r) => `${r.s.streak.worstLoss} derrotas`, 'bad'],
    ['Mejor winrate de temporada', pick(elig, (r) => r.rank.winrate), (r) => `${fmt(r.rank.winrate)}%`, 'good'],
    ['Peor winrate de temporada', pick(elig, (r) => r.rank.winrate, -1), (r) => `${fmt(r.rank.winrate)}%`, 'bad'],
    ['Mejor partida', pick(rows, (r) => r.s.bestGame.kda), (r) => `${r.s.bestGame.champ} ${r.s.bestGame.k}/${r.s.bestGame.d}/${r.s.bestGame.a}`, 'good', (r) => r.s.bestGame.champ, (r) => r.s.bestGame.id],
    ['Peor partida', pick(rows, (r) => r.s.worstGame.kda, -1), (r) => `${r.s.worstGame.champ} ${r.s.worstGame.k}/${r.s.worstGame.d}/${r.s.worstGame.a}`, 'bad', (r) => r.s.worstGame.champ, (r) => r.s.worstGame.id],
    ['Mejor campeón (5+ partidas)', pick(champs, (x) => x.c.winrate * 1000 + x.c.games), (x) => `${x.c.key} ${fmt(x.c.winrate, 0)}%`, 'good', (x) => x.c.key],
    ['Más partidas en temporada', pick(rows.filter((r) => r.rank), (r) => r.wins + r.losses), (r) => `${fmtInt(r.wins + r.losses)} partidas`, 'neutral'],
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
    for (const q of cand) for (const c of q.s.byRole[role]?.champs ?? []) if (c.games >= MIN_CHAMP_GAMES) pool.push({ q, c });
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
      h('span', { class: 'lbl' }, 'Mejor campeón del grupo aquí'),
      h('div', {}, champIcon(groupChamp.c.key, 22), h('b', {}, groupChamp.c.key),
        h('span', { class: 'muted' }, ` · ${groupChamp.q.name} · ${fmt(groupChamp.c.winrate, 0)}% (${groupChamp.c.games})`))) : null)));
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
    ...STAT_CARDS.map((d) => statCard(d, MODEL)).filter(Boolean), kdaCard(MODEL) ?? '', rolesCard(MODEL) ?? '');
  renderBest5(MODEL);
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
  document.getElementById('best5-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    best5Mode = b.dataset.mode;
    renderBest5(MODEL);
  });
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

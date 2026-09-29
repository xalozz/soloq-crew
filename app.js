'use strict';

const TIER_ES = {
  IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino',
  EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro',
  CHALLENGER: 'Challenger',
};
const ROLE_ES = { TOP: 'Top', JUNGLE: 'Jungla', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
const LINK_LABELS = { opgg: 'OP.GG', ugg: 'U.GG', dpm: 'DPM.LOL', log: 'LeagueOfGraphs' };

let DATA = null;
let sortKey = 'rank';
const expanded = new Set();

// ---------- helpers ----------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
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

const fmtNum = (n, d = 1) => (n == null ? '–' : Number(n).toFixed(d).replace(/\.0+$/, ''));
const tierClass = (t) => (t ? `tier-${t.toLowerCase()}` : 'tier-unranked');

function rankText(rank) {
  if (!rank) return 'Sin clasificar';
  const name = TIER_ES[rank.tier] ?? rank.tier;
  return APEX.has(rank.tier) ? name : `${name} ${rank.division}`;
}

function timeAgo(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const hrs = Math.round(min / 60);
  if (hrs < 48) return `hace ${hrs} h`;
  return `hace ${Math.round(hrs / 24)} días`;
}

function champIcon(champ, size = 28) {
  if (!champ || !DATA.ddragonVersion) return h('span', { class: 'champ-ph', style: `width:${size}px;height:${size}px` });
  return h('img', {
    class: 'champ', width: size, height: size, loading: 'lazy', alt: champ, title: champ,
    src: `https://ddragon.leagueoflegends.com/cdn/${DATA.ddragonVersion}/img/champion/${encodeURIComponent(champ)}.png`,
    onerror: (e) => e.target.replaceWith(h('span', { class: 'champ-ph', style: `width:${size}px;height:${size}px`, title: champ })),
  });
}

function profileIcon(acc, size = 44) {
  if (!acc?.profileIconId || !DATA.ddragonVersion) return h('span', { class: 'avatar-ph', style: `width:${size}px;height:${size}px` });
  return h('img', {
    class: 'avatar', width: size, height: size, alt: '', loading: 'lazy',
    src: `https://ddragon.leagueoflegends.com/cdn/${DATA.ddragonVersion}/img/profileicon/${acc.profileIconId}.png`,
    onerror: (e) => e.target.replaceWith(h('span', { class: 'avatar-ph', style: `width:${size}px;height:${size}px` })),
  });
}

function streakChip(streak) {
  if (!streak?.current?.count) return h('span', { class: 'muted' }, '–');
  const win = streak.current.type === 'W';
  return h('span', { class: `chip ${win ? 'chip-win' : 'chip-loss'}`, title: win ? 'Victorias seguidas' : 'Derrotas seguidas' },
    `${streak.current.count}${win ? 'V' : 'D'}`);
}

function formDots(form) {
  return h('span', { class: 'form', 'aria-label': 'Últimas partidas' },
    (form || []).map((r) => h('i', { class: r === 'W' ? 'w' : 'l', title: r === 'W' ? 'Victoria' : 'Derrota' })));
}

function rankBadge(rank) {
  return h('span', { class: `rank ${tierClass(rank?.tier)}` },
    h('b', {}, rankText(rank)),
    rank ? h('span', { class: 'lp' }, `${rank.lp} LP`) : null);
}

function wrBar(wins, losses) {
  const total = wins + losses;
  const wr = total ? (wins / total) * 100 : 0;
  return h('div', { class: 'wr' },
    h('div', { class: 'wr-bar' }, h('div', { class: 'wr-fill', style: `width:${wr}%` })),
    h('span', { class: 'wr-text' }, total ? `${fmtNum(wr)}%  ·  ${wins}V ${losses}D` : 'Sin partidas'));
}

const bestAcc = (p) => p.accounts[p.bestAccount] ?? p.accounts[0];
const mainStats = (p) => bestAcc(p)?.stats ?? null;
const totalGames = (p) => p.accounts.reduce((s, a) => s + (a.rank ? a.rank.wins + a.rank.losses : 0), 0);
const playerWinrate = (p) => {
  const w = p.accounts.reduce((s, a) => s + (a.rank?.wins ?? 0), 0);
  const g = totalGames(p);
  return g ? (w / g) * 100 : -1;
};
const streakValue = (p) => {
  const s = mainStats(p)?.streak?.current;
  if (!s?.count) return 0;
  return s.type === 'W' ? s.count : -s.count;
};

const SORTERS = {
  rank: (a, b) => b.score - a.score,
  winrate: (a, b) => playerWinrate(b) - playerWinrate(a),
  streak: (a, b) => streakValue(b) - streakValue(a),
  kda: (a, b) => (mainStats(b)?.kda ?? -1) - (mainStats(a)?.kda ?? -1),
  games: (a, b) => totalGames(b) - totalGames(a),
};

// ---------- ladder ----------
function statCell(label, value, sub) {
  return h('div', { class: 'stat' },
    h('span', { class: 'stat-l' }, label),
    h('span', { class: 'stat-v' }, value),
    sub ? h('span', { class: 'stat-s' }, sub) : null);
}

function groupLine(label, g, kind) {
  if (!g) return h('div', { class: 'bw' }, h('span', { class: 'bw-l' }, label), h('span', { class: 'muted' }, 'Pocos datos'));
  const name = kind === 'role' ? ROLE_ES[g.key] ?? g.key : g.key;
  return h('div', { class: 'bw' },
    h('span', { class: 'bw-l' }, label),
    kind === 'champ' ? champIcon(g.key, 22) : null,
    h('b', {}, name),
    h('span', { class: 'muted' }, `${fmtNum(g.winrate)}% · ${g.games} part. · KDA ${fmtNum(g.kda, 2)}`));
}

function gameLine(label, g) {
  if (!g) return null;
  return h('div', { class: 'bw' },
    h('span', { class: 'bw-l' }, label),
    champIcon(g.champ, 22),
    h('b', {}, `${g.k}/${g.d}/${g.a}`),
    h('span', { class: 'muted' }, `${g.win ? 'Victoria' : 'Derrota'} · KDA ${fmtNum(g.kda, 2)}`));
}

function accountCard(acc, isMain) {
  const s = acc.stats;
  const links = h('div', { class: 'links' },
    Object.entries(acc.links || {}).map(([k, url]) =>
      h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, LINK_LABELS[k] ?? k)));

  return h('div', { class: 'acc' },
    h('div', { class: 'acc-head' },
      profileIcon(acc, 36),
      h('div', { class: 'acc-id' },
        h('b', {}, acc.gameName, h('span', { class: 'muted' }, `#${acc.tagLine}`)),
        h('span', { class: 'muted small' },
          [acc.label, isMain ? 'Cuenta principal' : null, acc.level ? `Nivel ${acc.level}` : null, (acc.region || '').toUpperCase()]
            .filter(Boolean).join(' · '))),
      rankBadge(acc.rank)),
    acc.error ? h('p', { class: 'err' }, `No se pudo actualizar: ${acc.error}`) : null,
    acc.rank ? wrBar(acc.rank.wins, acc.rank.losses) : null,
    s ? h('div', { class: 'stats-grid' },
      statCell('Racha actual', streakChip(s.streak)),
      statCell('Mejor racha V', `${s.streak.bestWin}`),
      statCell('Peor racha D', `${s.streak.worstLoss}`),
      statCell('KDA', fmtNum(s.kda, 2), `${fmtNum(s.avgK)}/${fmtNum(s.avgD)}/${fmtNum(s.avgA)}`),
      statCell('CS/min', fmtNum(s.csPerMin)),
      statCell('Visión/min', fmtNum(s.visPerMin, 2)),
      statCell('% daño equipo', s.dmgShare == null ? '–' : `${fmtNum(s.dmgShare)}%`),
      statCell('Últimas 10', `${fmtNum(s.last10.winrate)}%`, formDots(s.form)),
      statCell('Muestra', `${s.games}`, 'partidas analizadas'))
      : h('p', { class: 'muted' }, 'Sin partidas de SoloQ guardadas todavía.'),
    s ? h('div', { class: 'bw-list' },
      groupLine('Mejor campeón', s.bestChamp, 'champ'),
      groupLine('Peor campeón', s.worstChamp, 'champ'),
      groupLine('Mejor rol', s.bestRole, 'role'),
      groupLine('Peor rol', s.worstRole, 'role'),
      gameLine('Mejor partida', s.bestGame),
      gameLine('Peor partida', s.worstGame)) : null,
    s?.topChamps?.length ? h('div', { class: 'top-champs' },
      h('span', { class: 'bw-l' }, 'Más jugados'),
      s.topChamps.map((c) => h('span', { class: 'tc', title: `${c.key}: ${c.games} partidas, ${fmtNum(c.winrate)}% WR` },
        champIcon(c.key, 26), h('small', {}, `${c.games}`)))) : null,
    links);
}

function playerRow(p, pos) {
  const main = bestAcc(p);
  const s = mainStats(p);
  const open = expanded.has(p.name);
  const wr = playerWinrate(p);

  const row = h('article', { class: `player ${open ? 'open' : ''}` },
    h('button', {
      class: 'player-head', 'aria-expanded': open,
      onclick: () => { open ? expanded.delete(p.name) : expanded.add(p.name); render(); },
    },
      h('span', { class: `pos ${pos <= 3 ? `pos-${pos}` : ''}` }, pos),
      profileIcon(main, 44),
      h('span', { class: 'who' },
        h('b', {}, p.name),
        h('span', { class: 'muted small' }, `${p.accounts.length} ${p.accounts.length === 1 ? 'cuenta' : 'cuentas'}`)),
      rankBadge(main?.rank),
      h('span', { class: 'cell wr-cell' }, wr < 0 ? '–' : `${fmtNum(wr)}%`, h('small', {}, 'winrate')),
      h('span', { class: 'cell' }, streakChip(s?.streak), h('small', {}, 'racha')),
      h('span', { class: 'cell hide-sm' }, s ? fmtNum(s.kda, 2) : '–', h('small', {}, 'KDA')),
      h('span', { class: 'cell hide-sm' }, formDots(s?.form)),
      h('span', { class: 'cell hide-md champs' }, (s?.topChamps ?? []).slice(0, 3).map((c) => champIcon(c.key, 26))),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '−' : '+')),
    open ? h('div', { class: 'player-body' },
      p.links?.length ? h('div', { class: 'links extra' }, p.links.map((l) =>
        h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label))) : null,
      h('div', { class: 'accs' }, p.accounts.map((a, i) => accountCard(a, p.accounts.length > 1 && i === p.bestAccount)))) : null);
  return row;
}

// ---------- records ----------
function buildRecords() {
  const rows = [];
  for (const p of DATA.players) for (const a of p.accounts) if (a.stats) rows.push({ p, a, s: a.stats });
  const games = (a) => (a.rank ? a.rank.wins + a.rank.losses : 0);

  const top = (items, val, dir = 1) =>
    items.length ? items.reduce((m, x) => (dir * (val(x) - val(m)) > 0 ? x : m)) : null;

  const winStreaks = rows.filter((r) => r.s.streak.current.type === 'W' && r.s.streak.current.count > 0);
  const lossStreaks = rows.filter((r) => r.s.streak.current.type === 'L' && r.s.streak.current.count > 0);
  const eligible = rows.filter((r) => r.a.rank && games(r.a) >= 30);
  const eligibleKda = rows.filter((r) => r.s.games >= 15);

  const defs = [
    ['Racha de victorias actual', top(winStreaks, (r) => r.s.streak.current.count), (r) => `${r.s.streak.current.count} seguidas`, 'good'],
    ['Mejor racha registrada', top(rows, (r) => r.s.streak.bestWin), (r) => `${r.s.streak.bestWin} victorias`, 'good'],
    ['Racha de derrotas actual', top(lossStreaks, (r) => r.s.streak.current.count), (r) => `${r.s.streak.current.count} seguidas`, 'bad'],
    ['Peor racha registrada', top(rows, (r) => r.s.streak.worstLoss), (r) => `${r.s.streak.worstLoss} derrotas`, 'bad'],
    ['Mejor winrate (30+ partidas)', top(eligible, (r) => r.a.rank.winrate), (r) => `${fmtNum(r.a.rank.winrate)}%`, 'good'],
    ['Peor winrate (30+ partidas)', top(eligible, (r) => r.a.rank.winrate, -1), (r) => `${fmtNum(r.a.rank.winrate)}%`, 'bad'],
    ['Mejor KDA medio', top(eligibleKda, (r) => r.s.kda), (r) => fmtNum(r.s.kda, 2), 'good'],
    ['Peor KDA medio', top(eligibleKda, (r) => r.s.kda, -1), (r) => fmtNum(r.s.kda, 2), 'bad'],
    ['Mejor partida', top(rows, (r) => r.s.bestGame.kda), (r) => `${r.s.bestGame.champ} ${r.s.bestGame.k}/${r.s.bestGame.d}/${r.s.bestGame.a}`, 'good'],
    ['Peor partida', top(rows, (r) => r.s.worstGame.kda, -1), (r) => `${r.s.worstGame.champ} ${r.s.worstGame.k}/${r.s.worstGame.d}/${r.s.worstGame.a}`, 'bad'],
    ['Más partidas jugadas', top(rows.filter((r) => r.a.rank), (r) => games(r.a)), (r) => `${games(r.a)} partidas`, 'neutral'],
    ['Más CS por minuto', top(eligibleKda, (r) => r.s.csPerMin), (r) => `${fmtNum(r.s.csPerMin)} CS/min`, 'good'],
  ];

  return defs.filter((d) => d[1]).map(([title, r, fmt, tone]) =>
    h('div', { class: `rec rec-${tone}` },
      h('span', { class: 'rec-t' }, title),
      h('b', { class: 'rec-v' }, fmt(r)),
      h('span', { class: 'rec-w' },
        h('b', {}, r.p.name),
        r.p.accounts.length > 1 ? h('span', { class: 'muted' }, ` · ${r.a.gameName}`) : null)));
}

// ---------- render ----------
function render() {
  document.getElementById('title').textContent = DATA.title;
  document.title = DATA.title;
  document.getElementById('subtitle').textContent = DATA.subtitle || '';
  document.getElementById('updated').textContent = `Últimos datos ${timeAgo(DATA.generatedAt)}`;
  document.getElementById('demo-banner').hidden = !DATA.demo;

  const players = [...DATA.players].sort(SORTERS[sortKey]);
  const ladder = document.getElementById('ladder');
  ladder.replaceChildren(...players.map((p, i) => playerRow(p, i + 1)));

  const rec = buildRecords();
  document.getElementById('records').replaceChildren(
    ...(rec.length ? rec : [h('p', { class: 'muted' }, 'Aún no hay suficientes partidas para calcular récords.')]));
}

async function init() {
  try {
    const res = await fetch(`data/data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    DATA = await res.json();
  } catch (err) {
    document.getElementById('ladder').textContent =
      'Todavía no hay datos. Aparecerán tras la primera actualización automática.';
    return;
  }
  document.getElementById('sort').addEventListener('change', (e) => { sortKey = e.target.value; render(); });
  render();
}

init();

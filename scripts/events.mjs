// Hitos: subidas y bajadas, pentas, rachas, récords del grupo y partidas jugadas.
// Se detectan comparando los datos publicados antes y después de cada pasada.

import { rankScore } from './stats.mjs';
import { SITE } from './discord.mjs';

export const TIER_ES = {
  IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Aspirante',
};
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVS = ['IV', 'III', 'II', 'I'];
const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
export const TIER_COLOR = {
  IRON: 0x8a7f79, BRONZE: 0xc07f4c, SILVER: 0xa9b8c6, GOLD: 0xe8b949, PLATINUM: 0x45c8b6, EMERALD: 0x35d08e,
  DIAMOND: 0x74a9ff, MASTER: 0xb77cf2, GRANDMASTER: 0xf06a6a, CHALLENGER: 0xf5d76e,
};
export const COLOR = { win: 0x33d69a, loss: 0xf2657e, accent: 0xd6ff3d, gold: 0xf5c542, neutral: 0x8e8e97 };

export const rankLabel = (r) => (!r ? 'Sin clasificar' : APEX.has(r.tier) ? `${TIER_ES[r.tier]} · ${r.lp} LP` : `${TIER_ES[r.tier] ?? r.tier} ${r.division}`);
export const rankLabelLp = (r) => (!r ? 'Sin clasificar' : APEX.has(r.tier) ? `${TIER_ES[r.tier]} · ${r.lp} LP` : `${TIER_ES[r.tier] ?? r.tier} ${r.division} · ${r.lp} LP`);
// Puntuación → "Esmeralda II · 40 LP"
export function scoreLabel(score) {
  if (score == null || score < 0) return '–';
  if (score >= 2800) return `Maestro+ · ${score - 2800} LP`;
  const t = Math.floor(score / 400), d = Math.floor((score % 400) / 100);
  return `${TIER_ES[TIERS[t]]} ${DIVS[d]} · ${score % 100} LP`;
}
export const crestUrl = (tier) => `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/${String(tier).toLowerCase()}.png`;
export const champUrl = (ver, champ) => (ver && champ ? `https://ddragon.leagueoflegends.com/cdn/${ver}/img/champion/${encodeURIComponent(champ)}.png` : null);
export const matchLink = (id) => `${SITE}#partida/${encodeURIComponent(id)}`;
export const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const k1 = (v) => `${(v / 1000).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`;
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// Escalón de división: 0 = Hierro IV … 27 = Diamante I; Maestro, GM y Aspirante, 28/29/30
function step(rank) {
  if (!rank?.tier) return null;
  if (APEX.has(rank.tier)) return 28 + TIERS.indexOf(rank.tier) - 7;
  return TIERS.indexOf(rank.tier) * 4 + DIVS.indexOf(rank.division);
}

export const RECORD_DEFS = {
  kills: ['Más kills', (v) => `${v} kills`],
  assists: ['Más asistencias', (v) => `${v} asistencias`],
  damage: ['Más daño a campeones', (v) => `${k1(v)} de daño`],
  vision: ['Más visión', (v) => `${v} de visión`],
  longestWin: ['Victoria más larga', (v) => mmss(v)],
  kda: ['Mejor KDA', (v) => `${String(v).replace('.', ',')} de KDA`],
  kp: ['Mayor participación', (v) => `${v}% de participación`],
  towers: ['Más daño a torres', (v) => `${k1(v)} a torres`],
  gold: ['Más oro', (v) => `${k1(v)} de oro`],
  csMin: ['Mejor CS/min', (v) => `${String(v).replace('.', ',')} CS/min`],
  q: ['Más "?" en una partida', (v) => `${v} pings de "?"`],
};

const STREAK_STEPS = [5, 7, 10, 15, 20];
const GAME_MILESTONES = [100, 200, 300, 500, 750, 1000, 1500, 2000];
const GAME_EVENT_MAX_AGE = 12 * 3600e3; // pentas, rachas…: solo de partidas de las últimas 12 h
const MAX_EVENTS = 12;

const mainAcc = (p) => p?.accounts?.[p.bestAccount] ?? p?.accounts?.[0] ?? null;
const accKey = (a) => a?.key ?? a?.riotId?.toLowerCase();

// prevPlayers / players: jugadores publicados antes y después.
// ctx: { now, newGames: Map(key → partidas nuevas), peakBefore: Map(key → mejor puntuación registrada) }
export function detectEvents(prevPlayers, players, ctx) {
  const now = ctx.now ?? Date.now();
  const events = [];
  const prevByName = new Map((prevPlayers ?? []).map((p) => [p.name, p]));

  // Récords del grupo antes de esta pasada
  const groupBest = {};
  for (const p of prevPlayers ?? []) {
    const recs = mainAcc(p)?.stats?.gameRecords ?? {};
    for (const [key, g] of Object.entries(recs)) {
      if (g && (!groupBest[key] || g.val > groupBest[key].val)) groupBest[key] = { ...g, name: p.name };
    }
  }

  for (const p of players) {
    const prevP = prevByName.get(p.name);
    const a = mainAcc(p), b = mainAcc(prevP);
    if (!a || !b || !b.stats || a.error) continue; // jugador nuevo o sin datos previos: nada que comparar
    const key = accKey(a);
    const base = { name: p.name, key };

    // Subidas y bajadas de división / liga
    const s0 = step(b.rank), s1 = step(a.rank);
    if (s0 == null && s1 != null) {
      events.push({ ...base, type: 'placed', t: now, tier: a.rank.tier, to: rankLabel(a.rank) });
    } else if (s0 != null && s1 != null && s0 !== s1) {
      const up = s1 > s0;
      const tierChange = a.rank.tier !== b.rank.tier;
      const peakBefore = ctx.peakBefore?.get(key);
      const peak = up && peakBefore != null && rankScore(a.rank) > peakBefore && Math.floor(rankScore(a.rank) / 100) > Math.floor(peakBefore / 100);
      events.push({
        ...base, type: up ? 'up' : 'down', t: now, tier: a.rank.tier, tierChange, peak,
        from: rankLabel(b.rank), to: rankLabel(a.rank), lp: a.rank.lp,
      });
    }

    // Partidas jugadas en la temporada
    const g0 = b.rank ? b.rank.wins + b.rank.losses : 0, g1 = a.rank ? a.rank.wins + a.rank.losses : 0;
    const ms = GAME_MILESTONES.filter((m) => g0 < m && g1 >= m).at(-1);
    if (ms) events.push({ ...base, type: 'games', t: now, n: ms });

    const fresh = (ctx.newGames?.get(key) ?? []).filter((g) => now - g.t < GAME_EVENT_MAX_AGE);
    if (!fresh.length) continue;

    // Pentas y cuádruples
    for (const g of fresh) {
      const type = g.penta ? 'penta' : g.quadra ? 'quadra' : null;
      if (type) events.push({ ...base, type, t: g.t, gameId: g.id, champ: g.champ, k: g.k, d: g.d, a: g.a, win: g.win });
    }

    // Rachas (al llegar a 5, 7, 10…) y rachas que se cortan
    const c0 = b.stats.streak?.current ?? {}, c1 = a.stats?.streak?.current ?? {};
    if (c1.type && c1.count) {
      const before = c0.type === c1.type ? c0.count : 0;
      const hit = STREAK_STEPS.filter((x) => before < x && c1.count >= x).at(-1);
      if (hit) events.push({ ...base, type: 'streak', t: fresh[0].t, kind: c1.type, n: c1.count });
      if (c0.type && c0.type !== c1.type && c0.count >= 5) events.push({ ...base, type: 'streakEnd', t: fresh[0].t, kind: c0.type, n: c0.count });
    }

    // Récords del grupo batidos con una partida nueva
    const freshIds = new Set(fresh.map((g) => g.id));
    for (const [rk, g] of Object.entries(a.stats?.gameRecords ?? {})) {
      const prev = groupBest[rk];
      if (!g || !freshIds.has(g.id) || !RECORD_DEFS[rk]) continue;
      if (prev && g.val <= prev.val) continue;
      events.push({
        ...base, type: 'record', t: g.t, gameId: g.id, rec: rk, val: g.val, champ: g.champ, k: g.k, d: g.d, a: g.a, win: g.win,
        prevName: prev?.name ?? null, prevVal: prev?.val ?? null,
      });
      groupBest[rk] = { ...g, name: p.name };
    }
  }

  for (const e of events) {
    e.id = `${e.type}:${e.key}:${e.gameId ?? e.to ?? e.n ?? ''}:${e.gameId ? '' : Math.floor(e.t / 60000)}`;
    e.text = eventText(e);
  }
  return events.sort((x, y) => x.t - y.t).slice(-MAX_EVENTS);
}

// Texto corto (web y Discord)
export function eventText(e) {
  switch (e.type) {
    case 'placed': return `🆕 ${e.name} se clasifica en ${e.to}`;
    case 'up': return e.tierChange ? `🎉 ${e.name} asciende a ${e.to}` : `⬆️ ${e.name} sube a ${e.to}`;
    case 'down': return e.tierChange ? `😬 ${e.name} desciende a ${e.to}` : `⬇️ ${e.name} baja a ${e.to}`;
    case 'games': return `🎮 ${e.name} llega a ${e.n} partidas esta temporada`;
    case 'penta': return `🖐️ ¡Pentakill de ${e.name} con ${e.champ}!`;
    case 'quadra': return `✋ Cuádruple de ${e.name} con ${e.champ}`;
    case 'streak': return e.kind === 'W' ? `🔥 ${e.name} lleva ${e.n} victorias seguidas` : `🧊 ${e.name} lleva ${e.n} derrotas seguidas`;
    case 'streakEnd': return e.kind === 'W' ? `✂️ Se acaba la racha de ${e.n} victorias de ${e.name}` : `🌤️ ${e.name} corta su racha de ${e.n} derrotas`;
    case 'record': return `🏆 Nuevo récord del grupo (${RECORD_DEFS[e.rec]?.[0] ?? e.rec}): ${e.name}, ${RECORD_DEFS[e.rec]?.[1](e.val) ?? e.val}`;
    case 'challengeStart': return `🏁 Empieza el reto «${e.title}»`;
    case 'challengeEnd': return e.winners?.length ? `🏆 ${e.winners.join(' y ')} gana${e.winners.length > 1 ? 'n' : ''} el reto «${e.title}»` : `🏁 Termina el reto «${e.title}»`;
    default: return e.type;
  }
}

// Mensaje de Discord para cada hito
export function eventEmbed(e, { ddVersion } = {}) {
  const kda = e.k != null ? `${e.champ} · ${e.k}/${e.d}/${e.a} · ${e.win ? 'victoria' : 'derrota'}` : null;
  const base = { title: e.text, url: e.gameId ? matchLink(e.gameId) : `${SITE}#novedades`, timestamp: new Date(e.t).toISOString() };
  switch (e.type) {
    case 'placed':
      return { ...base, color: TIER_COLOR[e.tier] ?? COLOR.accent, thumbnail: { url: crestUrl(e.tier) } };
    case 'up':
    case 'down': {
      const lines = [`Viene de ${e.from}${e.lp != null ? ` · ahora con ${e.lp} LP` : ''}`];
      if (e.peak) lines.push('🏔️ Su mejor elo desde que la web lo registra');
      return { ...base, description: lines.join('\n'), color: e.type === 'up' ? TIER_COLOR[e.tier] ?? COLOR.win : COLOR.loss, thumbnail: { url: crestUrl(e.tier) } };
    }
    case 'games':
      return { ...base, color: COLOR.accent };
    case 'penta':
    case 'quadra':
      return { ...base, description: kda, color: COLOR.gold, thumbnail: champUrl(ddVersion, e.champ) ? { url: champUrl(ddVersion, e.champ) } : undefined };
    case 'streak':
      return { ...base, description: e.kind === 'W' ? 'Que no pare 🚀' : 'Igual toca descansar un rato', color: e.kind === 'W' ? COLOR.win : COLOR.loss };
    case 'streakEnd':
      return { ...base, color: e.kind === 'W' ? COLOR.loss : COLOR.win };
    case 'record': {
      const def = RECORD_DEFS[e.rec];
      const prev = e.prevName ? `Antes: ${e.prevName}, ${def ? def[1](e.prevVal) : e.prevVal}` : null;
      return { ...base, description: [kda, prev].filter(Boolean).join('\n'), color: COLOR.accent, thumbnail: champUrl(ddVersion, e.champ) ? { url: champUrl(ddVersion, e.champ) } : undefined };
    }
    default:
      return { ...base, color: COLOR.neutral, description: e.desc ?? undefined };
  }
}

export function welcomeEmbed() {
  return {
    title: '✅ Avisos de SoloQ Crew activados',
    url: SITE,
    color: COLOR.accent,
    description: [
      'A partir de ahora este canal recibe:',
      '• ⬆️⬇️ Subidas y bajadas de división o liga',
      '• 🖐️ Pentakills, 🔥 rachas de 5+ victorias o derrotas y 🏆 récords del grupo',
      '• 📊 Cada lunes, el resumen de la semana',
      '',
      `Todo lo demás, en ${SITE}`,
    ].join('\n'),
  };
}

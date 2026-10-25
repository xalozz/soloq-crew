// Resumen semanal (lunes a domingo, hora de Madrid): web y mensaje de los lunes en Discord.

import { weekKey, rangeLabel } from './time.mjs';
import { scoreLabel, signed, COLOR, matchLink } from './events.mjs';
import { SITE } from './discord.mjs';

const kdaOf = (g) => (g.k + g.a) / Math.max(1, g.d);
const r1 = (x) => Math.round(x * 10) / 10;

// Puntuación registrada justo antes de t (o la primera dentro del rango si no hay ninguna antes)
function scoreAt(points, t, until) {
  let v = null;
  for (const [pt, s] of points) {
    if (pt < t) v = s;
    else break;
  }
  if (v == null) {
    const first = points.find(([pt]) => pt >= t && pt < until);
    v = first ? first[1] : null;
  }
  return v;
}

// entries: [{ name, games (temporada, cualquier orden), points: [[t, score, total]] }]
// from/to: ms (to exclusivo; null = semana en curso)
export function computeWeek(entries, from, to) {
  const until = to ?? Infinity;
  const players = entries.map((e) => {
    const games = e.games.filter((g) => g.t >= from && g.t < until).sort((a, b) => a.t - b.t);
    const wins = games.filter((g) => g.win).length;
    let runW = 0, runL = 0, bestW = 0, worstL = 0;
    for (const g of games) {
      if (g.win) { runW++; runL = 0; } else { runL++; runW = 0; }
      bestW = Math.max(bestW, runW); worstL = Math.max(worstL, runL);
    }
    const s0 = scoreAt(e.points, from, until);
    const s1 = scoreAt(e.points, until === Infinity ? Number.MAX_SAFE_INTEGER : until, Infinity);
    const long = games.filter((g) => g.dur >= 600);
    const best = long.length ? long.reduce((m, g) => (kdaOf(g) > kdaOf(m) || (kdaOf(g) === kdaOf(m) && g.k > m.k) ? g : m)) : null;
    const brief = (g) => (g ? { id: g.id, t: g.t, champ: g.champ, k: g.k, d: g.d, a: g.a, win: g.win, kda: r1(kdaOf(g)) } : null);
    return {
      name: e.name,
      games: games.length, wins, losses: games.length - wins,
      hours: r1(games.reduce((s, g) => s + (g.dur || 0), 0) / 3600),
      lp: games.length && s0 != null && s1 != null ? s1 - s0 : games.length ? null : 0,
      start: s0, end: s1,
      bestW, worstL,
      k: games.reduce((s, g) => s + g.k, 0), d: games.reduce((s, g) => s + g.d, 0), a: games.reduce((s, g) => s + g.a, 0),
      best: brief(best),
      pentas: games.filter((g) => g.penta).map(brief),
      ffLosses: games.filter((g) => !g.win && g.ff).length,
      pingGames: games.filter((g) => g.pg).length,
      q: games.reduce((s, g) => s + (g.pg?.q ?? 0), 0),
      ids: games.map((g) => [g.id, g.win]),
    };
  });

  // Dúo de la semana: misma partida y mismo resultado
  let duo = null;
  for (let i = 0; i < players.length; i++) {
    const mine = new Map(players[i].ids);
    for (let j = i + 1; j < players.length; j++) {
      const shared = players[j].ids.filter(([id, w]) => mine.get(id) === w);
      if (shared.length >= 2 && (!duo || shared.length > duo.games)) {
        duo = { a: players[i].name, b: players[j].name, games: shared.length, wins: shared.filter(([, w]) => w).length };
      }
    }
  }
  for (const p of players) delete p.ids;

  const active = players.filter((p) => p.games);
  const pick = (arr, f) => (arr.length ? arr.reduce((m, x) => (f(x) > f(m) ? x : m)) : null);
  const withLp = active.filter((p) => p.lp != null);
  const mvp = pick(withLp, (p) => p.lp * 1000 + p.wins);
  const worst = withLp.length > 1 ? pick(withLp, (p) => -p.lp * 1000 - p.losses) : null;
  const grinder = pick(active, (p) => p.games * 1000 + p.hours);
  const hot = pick(active, (p) => p.bestW);
  const cold = pick(active, (p) => p.worstL);
  const gotw = pick(active.filter((p) => p.best), (p) => p.best.kda * 100 + p.best.k);
  const coward = pick(active.filter((p) => p.ffLosses >= 2), (p) => p.ffLosses * 1000 - p.losses);
  const qKing = pick(active.filter((p) => p.pingGames >= 3 && p.q), (p) => p.q / p.pingGames);
  return {
    key: weekKey(from), from, to: to ?? null,
    players: players.sort((a, b) => (b.lp ?? -1e9) - (a.lp ?? -1e9) || b.games - a.games),
    totals: { games: active.reduce((s, p) => s + p.games, 0), wins: active.reduce((s, p) => s + p.wins, 0), hours: r1(active.reduce((s, p) => s + p.hours, 0)) },
    mvp: mvp && mvp.lp > 0 ? mvp.name : null,
    worst: worst && worst.lp < 0 ? worst.name : null,
    grinder: grinder?.name ?? null,
    hot: hot && hot.bestW >= 3 ? { name: hot.name, n: hot.bestW } : null,
    cold: cold && cold.worstL >= 3 ? { name: cold.name, n: cold.worstL } : null,
    duo,
    gotw: gotw ? { name: gotw.name, ...gotw.best } : null,
    pentas: active.flatMap((p) => p.pentas.map((g) => ({ name: p.name, ...g }))),
    coward: coward ? { name: coward.name, n: coward.ffLosses, of: coward.losses } : null,
    qKing: qKing ? { name: qKing.name, avg: r1(qKing.q / qKing.pingGames), total: qKing.q } : null,
  };
}

// Mensaje de los lunes
export function weekEmbed(w) {
  const byName = new Map(w.players.map((p) => [p.name, p]));
  const lines = w.players.map((p, i) => {
    if (!p.games) return `${i + 1}. ${p.name} · no jugó`;
    const lp = p.lp == null ? '¿? LP' : `${signed(p.lp)} LP`;
    return `${i + 1}. **${p.name}** · ${lp} · ${p.wins}V ${p.losses}D`;
  });
  const fields = [];
  const f = (name, value) => value && fields.push({ name, value, inline: true });
  if (w.mvp) { const p = byName.get(w.mvp); f('🏆 MVP', `${p.name} · ${signed(p.lp)} LP (${p.wins}V ${p.losses}D)`); }
  if (w.worst) { const p = byName.get(w.worst); f('📉 Peor semana', `${p.name} · ${signed(p.lp)} LP`); }
  if (w.grinder) { const p = byName.get(w.grinder); f('🎮 Más viciado', `${p.name} · ${p.games} partidas (${String(p.hours).replace('.', ',')} h)`); }
  if (w.hot) f('🔥 Mejor racha', `${w.hot.name} · ${w.hot.n} victorias seguidas`);
  if (w.cold) f('💀 Peor racha', `${w.cold.name} · ${w.cold.n} derrotas seguidas`);
  if (w.duo) f('🤝 Dúo de la semana', `${w.duo.a} & ${w.duo.b} · ${w.duo.games} partidas · ${w.duo.wins}V ${w.duo.games - w.duo.wins}D`);
  if (w.gotw) f('⭐ Partida de la semana', `${w.gotw.name} · [${w.gotw.champ} ${w.gotw.k}/${w.gotw.d}/${w.gotw.a}](${matchLink(w.gotw.id)})`);
  if (w.pentas.length) f('🖐️ Pentakills', w.pentas.map((g) => `${g.name} (${g.champ})`).join(', '));
  if (w.coward) f('🏳️ El más cobarde', `${w.coward.name} · rendición en ${w.coward.n} de sus ${w.coward.of} derrotas`);
  if (w.qKing) f('❓ El rey del "?"', `${w.qKing.name} · ${String(w.qKing.avg).replace('.', ',')} por partida`);
  const moves = w.players.filter((p) => p.games && p.start != null && p.end != null && Math.floor(p.start / 100) !== Math.floor(p.end / 100))
    .map((p) => `${p.name}: ${scoreLabel(p.start).split(' · ')[0]} → ${scoreLabel(p.end).split(' · ')[0]}`);
  if (moves.length) fields.push({ name: '↕️ Cambios de división', value: moves.join('\n'), inline: false });
  return {
    title: `📊 Resumen de la semana · ${rangeLabel(w.from, w.to)}`,
    url: `${SITE}#semana`,
    color: COLOR.accent,
    description: [
      `${w.totals.games} partidas entre todos · ${w.totals.games ? Math.round((w.totals.wins / w.totals.games) * 100) : 0} % de victorias · ${String(w.totals.hours).replace('.', ',')} h jugadas`,
      '',
      ...lines,
    ].join('\n'),
    fields,
    footer: { text: 'SoloQ Crew · LP registrados en la web' },
  };
}

// Versión compacta para el archivo de semanas
export function compactWeek(w) {
  return {
    key: w.key, from: w.from, to: w.to, totals: w.totals,
    mvp: w.mvp, worst: w.worst, grinder: w.grinder, hot: w.hot, cold: w.cold, duo: w.duo, gotw: w.gotw, pentas: w.pentas,
    coward: w.coward ?? null, qKing: w.qKing ?? null,
    players: w.players.map((p) => ({ name: p.name, games: p.games, wins: p.wins, losses: p.losses, lp: p.lp, hours: p.hours, start: p.start, end: p.end, bestW: p.bestW, worstL: p.worstL, k: p.k, d: p.d, a: p.a, best: p.best, ffLosses: p.ffLosses, q: p.q, pingGames: p.pingGames })),
  };
}

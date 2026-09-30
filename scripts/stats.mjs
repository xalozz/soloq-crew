// Cálculo de estadísticas a partir del historial compacto de partidas.
// Cada partida: { id, t, dur, win, champ, role, k, d, a, cs, vis, dmg, teamDmg }
// `history` siempre va ordenado de más reciente a más antiguo.

export const TIER_ORDER = [
  'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND',
  'MASTER', 'GRANDMASTER', 'CHALLENGER',
];
const DIVISION_ORDER = { IV: 0, III: 1, II: 2, I: 3 };
const APEX = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER']);

// Puntuación numérica para ordenar rangos: cada división = 100 LP.
export function rankScore(rank) {
  if (!rank || !rank.tier) return -1;
  const tier = TIER_ORDER.indexOf(rank.tier);
  if (tier < 0) return -1;
  if (APEX.has(rank.tier)) return 2800 + rank.lp; // Master+ continúa justo tras Diamante I 100 LP
  const div = DIVISION_ORDER[rank.division] ?? 0;
  return tier * 400 + div * 100 + rank.lp;
}

const MIN_GAMES_GROUP = 3; // mínimo de partidas para considerar campeón/rol en mejor/peor

const kda = (k, d, a) => (k + a) / Math.max(1, d);
const pct = (w, n) => (n ? Math.round((w / n) * 1000) / 10 : 0);
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;

function streaks(history) {
  // current: desde la partida más reciente
  let current = { type: null, count: 0 };
  if (history.length) {
    const type = history[0].win ? 'W' : 'L';
    let count = 0;
    for (const g of history) {
      if ((g.win ? 'W' : 'L') !== type) break;
      count++;
    }
    current = { type, count };
  }
  // best / worst recorriendo de antigua a reciente
  let bestWin = 0, worstLoss = 0, runW = 0, runL = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].win) { runW++; runL = 0; } else { runL++; runW = 0; }
    if (runW > bestWin) bestWin = runW;
    if (runL > worstLoss) worstLoss = runL;
  }
  return { current, bestWin, worstLoss };
}

function groupBy(history, keyFn) {
  const map = new Map();
  for (const g of history) {
    const key = keyFn(g);
    if (!key) continue;
    const e = map.get(key) ?? { key, games: 0, wins: 0, k: 0, d: 0, a: 0 };
    e.games++;
    if (g.win) e.wins++;
    e.k += g.k; e.d += g.d; e.a += g.a;
    map.set(key, e);
  }
  return [...map.values()].map((e) => ({
    key: e.key,
    games: e.games,
    wins: e.wins,
    winrate: pct(e.wins, e.games),
    kda: r2(kda(e.k, e.d, e.a)),
  }));
}

function bestWorst(groups) {
  const q = groups.filter((g) => g.games >= MIN_GAMES_GROUP);
  if (q.length < 2) return { best: q[0] ?? null, worst: null };
  const sorted = [...q].sort(
    (x, y) => y.winrate - x.winrate || y.games - x.games || y.kda - x.kda,
  );
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

function gameBrief(g) {
  return {
    id: g.id, t: g.t, champ: g.champ, role: g.role,
    k: g.k, d: g.d, a: g.a, win: g.win, kda: r2(kda(g.k, g.d, g.a)),
  };
}

export function computeAccountStats(history) {
  const n = history.length;
  if (!n) return null;

  const wins = history.filter((g) => g.win).length;
  const sum = (f) => history.reduce((s, g) => s + f(g), 0);
  const K = sum((g) => g.k), D = sum((g) => g.d), A = sum((g) => g.a);
  const minutes = sum((g) => g.dur) / 60;
  const teamDmg = sum((g) => g.teamDmg || 0);

  const champs = groupBy(history, (g) => g.champ).sort((a, b) => b.games - a.games);
  const roles = groupBy(history, (g) => g.role);
  const cw = bestWorst(champs);
  const rw = bestWorst(roles);

  const withKda = history.map((g) => ({ g, v: kda(g.k, g.d, g.a) }));
  const bestGame = withKda.reduce((m, x) => (x.v > m.v || (x.v === m.v && x.g.k > m.g.k) ? x : m));
  const worstGame = withKda.reduce((m, x) => (x.v < m.v || (x.v === m.v && x.g.d > m.g.d) ? x : m));

  const last = (cnt) => history.slice(0, cnt);
  const wrLast = (cnt) => {
    const s = last(cnt);
    const w = s.filter((g) => g.win).length;
    return { games: s.length, wins: w, losses: s.length - w, winrate: pct(w, s.length) };
  };
  const mainRole = [...roles].sort((a, b) => b.games - a.games)[0]?.key ?? null;

  return {
    games: n,
    wins,
    losses: n - wins,
    winrate: pct(wins, n),
    avgK: r1(K / n), avgD: r1(D / n), avgA: r1(A / n),
    kda: r2(kda(K, D, A)),
    csPerMin: r1(sum((g) => g.cs) / Math.max(1, minutes)),
    visPerMin: r2(sum((g) => g.vis) / Math.max(1, minutes)),
    dmgShare: teamDmg ? Math.round((sum((g) => g.dmg) / teamDmg) * 1000) / 10 : null,
    avgDurationMin: r1(minutes / n),
    streak: streaks(history),
    form: history.slice(0, 10).map((g) => (g.win ? 'W' : 'L')),
    trend: history.slice(0, 20).reverse().map((g) => (g.win ? 1 : 0)), // antigua → reciente
    mainRole,
    last10: wrLast(10),
    last20: wrLast(20),
    topChamps: champs.slice(0, 5),
    bestChamp: cw.best,
    worstChamp: cw.worst,
    bestRole: rw.best,
    worstRole: rw.worst,
    bestGame: gameBrief(bestGame.g),
    worstGame: gameBrief(worstGame.g),
    firstGameAt: history[n - 1].t,
    lastGameAt: history[0].t,
    totals: { k: K, d: D, a: A },
    dmgPerMin: Math.round(sum((g) => g.dmg) / Math.max(1, minutes)),
    avgVision: r1(sum((g) => g.vis) / n),
    pentas: sum((g) => g.penta || 0),
    firstBloods: sum((g) => (g.fb ? 1 : 0)),
    maxKills: Math.max(...history.map((g) => g.k)),
    maxDurationMin: r1(Math.max(...history.map((g) => g.dur)) / 60),
    avgKp: (() => {
      const withKp = history.filter((g) => g.kp != null);
      return withKp.length ? Math.round(withKp.reduce((s, g) => s + g.kp, 0) / withKp.length) : null;
    })(),
    champs: champs.map((c) => {
      const games = history.filter((g) => g.champ === c.key);
      const mins = games.reduce((s, g) => s + g.dur, 0) / 60;
      return { ...c, csPerMin: r1(games.reduce((s, g) => s + g.cs, 0) / Math.max(1, mins)) };
    }),
    roles: roles.sort((a, b) => b.games - a.games),
    gold: goldStats(history),
    byRole: roleBreakdown(history),
  };
}

// Rendimiento por rol y, dentro de cada rol, por campeón (para el "Best 5").
function roleBreakdown(history) {
  const out = {};
  for (const role of ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']) {
    const games = history.filter((g) => g.role === role);
    if (!games.length) continue;
    const wins = games.filter((g) => g.win).length;
    const K = games.reduce((s, g) => s + g.k, 0), D = games.reduce((s, g) => s + g.d, 0), A = games.reduce((s, g) => s + g.a, 0);
    const gd = games.filter((g) => g.gold?.gd15 != null);
    out[role] = {
      games: games.length, wins, winrate: pct(wins, games.length), kda: r2(kda(K, D, A)),
      gd15: gd.length ? Math.round(gd.reduce((s, g) => s + g.gold.gd15, 0) / gd.length) : null,
      champs: groupBy(games, (g) => g.champ).sort((a, b) => b.games - a.games).slice(0, 6),
    };
  }
  return out;
}

// Estadísticas de oro (solo partidas con timeline descargado).
const THROW_MIN = 3000; // ventaja de equipo a partir de la cual perder cuenta como "throw"
function goldStats(history) {
  const g = history.filter((x) => x.gold);
  if (!g.length) return null;
  const brief = (x, val) => (x ? { ...gameBrief(x), val, dur: x.dur, min: x.gold.maxLeadMin } : null);
  const by = (arr, f, dir = 1) => (arr.length ? arr.reduce((m, x) => (dir * (f(x) - f(m)) > 0 ? x : m)) : null);
  const losses = g.filter((x) => !x.win), wins = g.filter((x) => x.win);
  const with15 = g.filter((x) => x.gold.gd15 != null);
  const throwG = by(losses, (x) => x.gold.maxLead);
  const comebackG = by(wins, (x) => x.gold.maxDef, -1);
  const leadG = by(g, (x) => x.gold.maxLead);
  const best15 = by(with15, (x) => x.gold.gd15);
  const worst15 = by(with15, (x) => x.gold.gd15, -1);
  return {
    games: g.length,
    avgGd15: with15.length ? Math.round(with15.reduce((s, x) => s + x.gold.gd15, 0) / with15.length) : null,
    avgTgd15: Math.round(g.filter((x) => x.gold.tgd15 != null).reduce((s, x, _, a) => s + x.gold.tgd15 / a.length, 0)),
    throws: losses.filter((x) => x.gold.maxLead >= THROW_MIN).length,
    comebacks: wins.filter((x) => x.gold.maxDef <= -THROW_MIN).length,
    biggestThrow: throwG && throwG.gold.maxLead > 0 ? brief(throwG, throwG.gold.maxLead) : null,
    biggestComeback: comebackG && comebackG.gold.maxDef < 0 ? brief(comebackG, comebackG.gold.maxDef) : null,
    biggestLead: leadG ? brief(leadG, leadG.gold.maxLead) : null,
    best15: best15 ? brief(best15, best15.gold.gd15) : null,
    worst15: worst15 ? brief(worst15, worst15.gold.gd15) : null,
  };
}

// Resumen por jugador: cuenta principal = la de mayor rango.
export function pickBestAccount(accounts) {
  let best = -1, bestScore = -2;
  accounts.forEach((acc, i) => {
    const s = rankScore(acc.rank);
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return { index: best, score: bestScore };
}

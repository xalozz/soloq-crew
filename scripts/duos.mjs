// Estadísticas de las partidas que dos miembros del grupo han jugado juntos (mismo equipo)
// o enfrentados. Se detectan porque el mismo ID de partida aparece en el historial de ambos:
// mismo resultado = mismo equipo, resultado distinto = rivales.

const RECENT_TOGETHER = 12;
const DEFAULT_LP = { win: 25, loss: -25 };

// entries: [{ name, games (temporada, más reciente primero), lpMap, lpAvg: {win, loss} }]
export function computeDuos(entries) {
  const byId = entries.map((e) => new Map(e.games.map((g) => [g.id, g])));
  const duos = [], rivals = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const together = [], against = [];
      for (const [id, g] of byId[i]) {
        const o = byId[j].get(id);
        if (!o) continue;
        (o.win === g.win ? together : against).push([g, o]);
      }
      if (together.length) duos.push(duoStats(entries[i], entries[j], together, byId[i], byId[j]));
      if (against.length) rivals.push(rivalStats(entries[i], entries[j], against));
    }
  }
  duos.sort((a, b) => b.games - a.games || b.wr - a.wr);
  rivals.sort((a, b) => b.games - a.games);
  return { duos, rivals };
}

function lpOf(entry, g) {
  const x = entry.lpMap?.get(g.id);
  if (x && x.n === 1) return { lp: x.d, exact: true };
  const avg = entry.lpAvg ?? {};
  const v = g.win ? (avg.win ?? DEFAULT_LP.win) : (avg.loss ?? DEFAULT_LP.loss);
  return { lp: v, exact: false };
}

const pct = (w, n) => (n ? Math.round((w / n) * 1000) / 10 : 0);

function side(entry, pairs, idx, allGames, togetherIds) {
  let lp = 0, est = 0, k = 0, d = 0, a = 0;
  const champs = new Map();
  for (const pair of pairs) {
    const g = pair[idx];
    const r = lpOf(entry, g);
    lp += r.lp;
    if (!r.exact) est++;
    k += g.k; d += g.d; a += g.a;
    champs.set(g.champ, (champs.get(g.champ) ?? 0) + 1);
  }
  const n = pairs.length;
  // Winrate de este jugador en el resto de sus partidas (sin el compañero)
  let ow = 0, on = 0;
  for (const g of allGames.values()) if (!togetherIds.has(g.id)) { on++; if (g.win) ow++; }
  const top = [...champs].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c, c2]) => [c, c2]);
  return {
    name: entry.name,
    lp: Math.round(lp), lpEst: est,
    kda: { k: +(k / n).toFixed(1), d: +(d / n).toFixed(1), a: +(a / n).toFixed(1), ratio: +((k + a) / Math.max(1, d)).toFixed(2) },
    wrWithout: pct(ow, on), gamesWithout: on,
    champs: top,
  };
}

function duoStats(A, B, pairs, allA, allB) {
  const ids = new Set(pairs.map(([g]) => g.id));
  const wins = pairs.filter(([g]) => g.win).length;
  // pairs viene en orden de más reciente a más antigua
  let streak = 0;
  for (const [g] of pairs) { if (g.win === pairs[0][0].win) streak++; else break; }
  let bestW = 0, bestL = 0, cw = 0, cl = 0;
  for (const [g] of [...pairs].reverse()) {
    if (g.win) { cw++; cl = 0; } else { cl++; cw = 0; }
    bestW = Math.max(bestW, cw); bestL = Math.max(bestL, cl);
  }
  const dur = pairs.reduce((s, [g]) => s + g.dur, 0);
  return {
    a: A.name, b: B.name,
    games: pairs.length, wins, losses: pairs.length - wins, wr: pct(wins, pairs.length),
    streak: { win: pairs[0][0].win, n: streak },
    bestWin: bestW, bestLoss: bestL,
    first: pairs.at(-1)[0].t, last: pairs[0][0].t,
    hours: Math.round(dur / 360) / 10,
    sides: [side(A, pairs, 0, allA, ids), side(B, pairs, 1, allB, ids)],
    recent: pairs.slice(0, RECENT_TOGETHER).map(([g, o]) => ({
      id: g.id, t: g.t, win: g.win,
      c: [g.champ, o.champ], kda: [[g.k, g.d, g.a], [o.k, o.d, o.a]],
      lp: [lpOf(A, g), lpOf(B, o)].map((x) => (x.exact ? x.lp : null)),
    })),
  };
}

function rivalStats(A, B, pairs) {
  const aWins = pairs.filter(([g]) => g.win).length;
  return {
    a: A.name, b: B.name, games: pairs.length, aWins, bWins: pairs.length - aWins,
    recent: pairs.slice(0, RECENT_TOGETHER).map(([g, o]) => ({
      id: g.id, t: g.t, aWin: g.win, c: [g.champ, o.champ], kda: [[g.k, g.d, g.a], [o.k, o.d, o.a]],
    })),
  };
}

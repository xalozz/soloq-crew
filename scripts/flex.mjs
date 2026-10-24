// Flex (cola 440) y Clash (cola 700): historial propio por cuenta y estadísticas de las partidas en grupo.

import { readFile, writeFile } from 'node:fs/promises';
import { RiotError, compactMatch } from './riot.mjs';

export const QUEUE_FLEX = 440;
export const QUEUE_CLASH = 700;
const FLEX_CAP = 400;

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
};
const isKeyError = (err) => err instanceof RiotError && (err.status === 401 || err.status === 403);

// Descarga las partidas nuevas de Flex y Clash de una cuenta (con un presupuesto por pasada)
export async function updateFlexHistory(riot, region, puuid, file, dd, budget) {
  const stored = await readJson(file, { games: [], skipped: [] });
  const games = stored.games ?? [];
  const skipped = new Set(stored.skipped ?? []);
  const have = new Set(games.map((g) => g.id));
  const ids = [];
  for (const [queue, count] of [[QUEUE_FLEX, 40], [QUEUE_CLASH, 10]]) {
    try {
      ids.push(...await riot.matchIds(region, puuid, { queue, count }));
    } catch (err) {
      if (isKeyError(err)) throw err;
      console.warn(`  ! ids cola ${queue}: ${err.message}`);
    }
  }
  const todo = ids.filter((id) => !have.has(id) && !skipped.has(id)).slice(0, Math.max(0, budget.flex));
  budget.flex -= todo.length;
  for (const id of todo) {
    try {
      const rec = compactMatch(await riot.match(region, id), puuid, dd, null);
      if (rec) games.push(rec); else skipped.add(id);
    } catch (err) {
      if (isKeyError(err)) throw err;
      console.warn(`  ! partida flex ${id}: ${err.message}`);
    }
  }
  games.sort((a, b) => b.t - a.t);
  games.length = Math.min(games.length, FLEX_CAP);
  if (todo.length || !Array.isArray(stored.games)) {
    await writeFile(file, `${JSON.stringify({ games, skipped: [...skipped].slice(-500) }, null, 2)}\n`);
  }
  if (todo.length) console.log(`  flex/clash: ${todo.length} partidas nuevas`);
  return games;
}

export async function readFlexHistory(file) {
  return (await readJson(file, { games: [] })).games ?? [];
}

const pct = (w, n) => (n ? Math.round((w / n) * 1000) / 10 : 0);

// entries: [{ name, flexRank, games: [...] (flex + clash) }]
export function flexGroupStats(entries) {
  const players = entries.map((e) => {
    const flex = e.games.filter((g) => g.q === QUEUE_FLEX);
    const wins = flex.filter((g) => g.win).length;
    const roles = {};
    for (const g of flex) if (g.role) roles[g.role] = (roles[g.role] ?? 0) + 1;
    const champs = {};
    for (const g of flex) champs[g.champ] = (champs[g.champ] ?? 0) + 1;
    return {
      name: e.name, rank: e.flexRank ?? null,
      games: flex.length, wins, winrate: pct(wins, flex.length),
      clash: e.games.filter((g) => g.q === QUEUE_CLASH).length,
      roles,
      champs: Object.entries(champs).sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  });

  // Partidas en grupo: mismo id y mismo resultado = mismo equipo
  const byGame = new Map();
  for (const e of entries) {
    for (const g of e.games) {
      const x = byGame.get(g.id) ?? { id: g.id, t: g.t, q: g.q, dur: g.dur, teams: new Map() };
      const team = x.teams.get(g.win) ?? [];
      team.push({ name: e.name, champ: g.champ, role: g.role, k: g.k, d: g.d, a: g.a });
      x.teams.set(g.win, team);
      byGame.set(g.id, x);
    }
  }
  const lineups = new Map();
  const group = [];
  for (const x of byGame.values()) {
    for (const [win, team] of x.teams) {
      if (team.length < 2) continue;
      const names = team.map((m) => m.name).sort();
      const key = names.join('|');
      const l = lineups.get(key) ?? { names, n: 0, w: 0, last: 0, flex: 0, clash: 0 };
      l.n++;
      if (win) l.w++;
      l.last = Math.max(l.last, x.t);
      if (x.q === QUEUE_CLASH) l.clash++; else l.flex++;
      lineups.set(key, l);
      group.push({ id: x.id, t: x.t, q: x.q, dur: x.dur, win, members: team });
    }
  }
  group.sort((a, b) => b.t - a.t);
  return {
    players: players.filter((p) => p.rank || p.games || p.clash),
    lineups: [...lineups.values()].map((l) => ({ ...l, wr: pct(l.w, l.n) })).sort((a, b) => b.names.length - a.names.length || b.n - a.n),
    recent: group.filter((g) => g.q === QUEUE_FLEX).slice(0, 20),
    clash: group.filter((g) => g.q === QUEUE_CLASH).slice(0, 30),
  };
}

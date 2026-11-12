// Modelo del ranking: un jugador con su cuenta principal, posición, cambio del día y datos del periodo
import type { Account, Data, LiveGame, PlayerRaw, Rank, SeqGame, Stats, Tilt } from '../types';
import { dayStartMs, monthStartMs, rankScore, scoreAtStart, weekStartMs } from './util';

export interface Player extends PlayerRaw {
  main: Account | undefined;
  s: Stats | null;
  rank: Rank | null;
  score: number;
  baseScore: number | null;
  wins: number;
  losses: number;
  winrate: number;
  totalGames: number;
  streakVal: number;
  pos: number;
  posDelta?: number;
}

export type PeriodKey = 'day' | 'week' | 'month';
export interface PeriodInfo { lp: number | null; games: number; wins: number; losses: number }
/** Jugador con los datos del periodo elegido (hoy, semana o mes) */
export interface RowPlayer extends Player {
  per: PeriodInfo;
  perPrev: { lp: number | null; games: number };
  perPos: number | null;
  perDelta: number | null;
}

export function buildModel(raw: Data): Player[] {
  const players: Player[] = raw.players.map((p) => {
    const main = p.accounts[p.bestAccount] ?? p.accounts[0];
    const s = main?.stats ?? null;
    const rank = main?.rank ?? null;
    const score = rankScore(rank);
    const base = scoreAtStart(main?.lpHist, dayStartMs(Date.now()));
    const totalW = p.accounts.reduce((n, a) => n + (a.rank?.wins ?? 0), 0);
    const totalL = p.accounts.reduce((n, a) => n + (a.rank?.losses ?? 0), 0);
    return {
      ...p, main, s, rank, score,
      baseScore: base,
      wins: rank?.wins ?? 0, losses: rank?.losses ?? 0,
      winrate: rank ? rank.winrate : -1,
      totalGames: totalW + totalL,
      streakVal: s?.streak?.current?.count ? (s.streak.current.type === 'W' ? 1 : -1) * s.streak.current.count : 0,
      pos: 0,
    };
  });
  // Posición por elo y cambio respecto al inicio del día
  const byScore = [...players].sort((a, b) => b.score - a.score);
  byScore.forEach((p, i) => { p.pos = i + 1; });
  const withBase = players.filter((p) => p.baseScore != null);
  if (withBase.length >= 2) {
    [...withBase].sort((a, b) => b.baseScore! - a.baseScore!).forEach((p, i) => { p.posDelta = i + 1 - p.pos; });
  }
  return players;
}

// LP, partidas y puesto de cada uno en el periodo elegido (hoy, semana o mes) y en el anterior
export const PERIODS: Record<PeriodKey, { short: string; this: string; prev: string; start: (t: number) => number }> = {
  day: { short: 'hoy', this: 'hoy', prev: 'ayer', start: dayStartMs },
  week: { short: 'semana', this: 'esta semana', prev: 'la semana pasada', start: weekStartMs },
  month: { short: 'mes', this: 'este mes', prev: 'el mes pasado', start: monthStartMs },
};
function gamesBetween(acc: Account | undefined, from: number, to = Infinity): SeqGame[] {
  const seq: SeqGame[] = acc?.seq ?? (acc?.recent ?? []).map((g): SeqGame => [g.t, g.win ? 1 : 0]);
  return seq.filter(([t]) => t >= from && t < to);
}
export function applyPeriod(players: Player[], period: PeriodKey): RowPlayer[] {
  const P = PERIODS[period];
  const start = P.start(Date.now()), prevStart = P.start(start - 1);
  const rows: RowPlayer[] = players.map((p) => {
    const hist = p.main?.lpHist;
    const base = scoreAtStart(hist, start), prevBase = scoreAtStart(hist, prevStart);
    const g = gamesBetween(p.main, start), gp = gamesBetween(p.main, prevStart, start);
    const wins = g.filter((x) => x[1]).length;
    return {
      ...p,
      per: { lp: base != null && p.score >= 0 ? p.score - base : null, games: g.length, wins, losses: g.length - wins },
      perPrev: { lp: base != null && prevBase != null ? base - prevBase : null, games: gp.length },
      perPos: null,
      perDelta: null,
    };
  });
  const order = (key: 'per' | 'perPrev') => (a: RowPlayer, b: RowPlayer) => (b[key].lp ?? -1e9) - (a[key].lp ?? -1e9) || b.score - a.score;
  const now = rows.filter((p) => p.per.games).sort(order('per'));
  const before = rows.filter((p) => p.perPrev.games).sort(order('perPrev'));
  now.forEach((p, i) => {
    p.perPos = i + 1;
    const j = before.indexOf(p);
    p.perDelta = j >= 0 ? j - i : null;
  });
  return rows;
}

export type SortKey = 'rank' | 'period' | 'winrate' | 'streak' | 'kda';
export const SORTERS: Record<SortKey, (a: RowPlayer, b: RowPlayer) => number> = {
  rank: (a, b) => b.score - a.score,
  period: (a, b) => (b.per.games ? 1 : 0) - (a.per.games ? 1 : 0) || (b.per.lp ?? -1e9) - (a.per.lp ?? -1e9) || b.score - a.score,
  winrate: (a, b) => b.winrate - a.winrate,
  streak: (a, b) => b.streakVal - a.streakVal,
  kda: (a, b) => (b.s?.kda ?? -1) - (a.s?.kda ?? -1),
};
export const byRank = (a: Player, b: Player): number => b.score - a.score;

// ---------------------------------------------------------------- en directo
export function liveOf(live: LiveGame[], name: string): { g: LiveGame; me: LiveGame['p'][number] } | null {
  for (const g of live) {
    const me = g.p.find((x) => x.n === name);
    if (me) return { g, me };
  }
  return null;
}
export const liveMinTxt = (start: number | null | undefined): string => (start ? `${Math.max(0, Math.floor((Date.now() - start) / 60000))} min` : 'cargando');

// ---------------------------------------------------------------- tilt (aviso en el ranking)
const TILT_K = 10;
export const shrink = (w: number, n: number, p0: number): number => (w + TILT_K * p0) / (n + TILT_K);
// Punto de parada: el primer nº de derrotas seguidas tras el que su winrate cae claramente (≥ 4 puntos)
export function tiltRule(t: Pick<Tilt, 'prev'> | undefined, wrPct: number | undefined): { k: number; w: number; n: number; wr: number } | null {
  if (!t?.prev) return null;
  const p0 = (wrPct ?? 50) / 100;
  for (let k = 1; k <= 4; k++) {
    const [w, n] = t.prev[3 + k] ?? [0, 0];
    if (n >= 12 && shrink(w, n, p0) <= p0 - 0.04) return { k, w, n, wr: (w / n) * 100 };
  }
  return null;
}
// Hoy lleva tantas derrotas seguidas como su punto de parada (3 si no tiene uno claro) y sigue en sesión
export function tiltNow(p: Player): string | null {
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

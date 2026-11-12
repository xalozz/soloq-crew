// Series de elo para las gráficas
import type { Account, LpPoint } from '../types';
import type { Player } from './model';
import { rankScore } from './util';

/** [momento, puntuación, estimado] */
export type EloPt = [number, number, boolean];
/** Igual pero con el estimado como 1/0 (gráficas del grupo y del comparador) */
export type EloPtN = [number, number, number];

export interface EloSeries { est: LpPoint[]; real: LpPoint[]; W: number; L: number; measured: boolean }

// Serie de elo: tramo registrado (lpHist) + tramo reconstruido hacia atrás con el resultado de cada partida.
export function eloSeries(acc: Account): EloSeries {
  const real: LpPoint[] = (acc.lpHist ?? []).map(([t, v]) => [t, v]);
  const lp = acc.stats?.lp;
  const W = lp?.win ?? 25, L = Math.abs(lp?.loss ?? -25);
  const T0 = real.length ? real[0][0] : Date.now();
  let sc = real.length ? real[0][1] : rankScore(acc.rank);
  const est: LpPoint[] = [];
  if (sc >= 0) {
    const before = (acc.seq ?? []).filter((g) => g[0] < T0).sort((x, y) => y[0] - x[0]);
    if (before.length) est.push([T0, sc]);
    for (const [t, win, d] of before) {
      est.push([t, sc]);
      sc = Math.max(0, sc - (d ?? (win ? W : -L)));
    }
    if (before.length) est.push([before[before.length - 1][0] - 30 * 60e3, sc]);
    est.reverse();
  }
  return { est, real, W, L, measured: !!(lp?.winN || lp?.lossN) };
}

export const TIER_HEX = ['#8a7f79', '#c07f4c', '#a9b8c6', '#e8b949', '#45c8b6', '#35d08e', '#74a9ff', '#b77cf2'];
export const tierHex = (score: number): string => TIER_HEX[Math.min(7, Math.max(0, Math.floor(score / 400)))];
export const ELO_RANGES: [number, string][] = [[7, '7 días'], [30, '30 días'], [0, 'Temporada']];

// Puntos [t, score, estimado] de toda la curva, uno por partida (o cambio de LP registrado)
export function eloPoints({ est, real }: EloSeries): EloPt[] {
  const pts = [...est.map((p): EloPt => [p[0], p[1], true]), ...real.map((p): EloPt => [p[0], p[1], false])]
    .sort((a, b) => a[0] - b[0])
    .filter((p, i, arr) => i === 0 || p[1] !== arr[i - 1][1] || p[2] !== arr[i - 1][2]);
  if (pts.length === 1) pts.push([Date.now(), pts[0][1], false]);
  return pts;
}

// Cambio de LP desde hace `days` días (el valor de antes de esa fecha como punto de partida)
export function eloDelta(pts: EloPt[], days: number): number | null {
  if (pts.length < 2) return null;
  const from = Date.now() - days * 864e5;
  const before = pts.filter((p) => p[0] <= from).at(-1) ?? pts[0];
  return pts[pts.length - 1][1] - before[1];
}

// Curva suave que no se pasa de los puntos (monotone cubic)
export function smoothPath(P: [number, number][]): string {
  if (P.length < 3) return P.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const n = P.length, dx: number[] = [], m: number[] = [], tg: number[] = [];
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

/** Serie completa de un jugador (estimado + registrado + ahora) para las gráficas del grupo y del comparador */
export function playerPts(p: Player): EloPtN[] {
  const { est, real } = eloSeries(p.main!);
  const pts = [...est.map((x): EloPtN => [x[0], x[1], 1]), ...real.map((x): EloPtN => [x[0], x[1], 0])].sort((a, b) => a[0] - b[0]);
  if (p.score >= 0) pts.push([Date.now(), p.score, 0]);
  return pts;
}

// Contador de degradados (ids únicos por dibujo, como en la versión anterior)
let eloGradId = 0;
export const nextGradId = (): string => `eg${++eloGradId}`;

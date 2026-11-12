// Constantes, formatos, fechas en hora de Madrid y rangos
import type { LpPoint, Rank, Role, Tier } from '../types';

export const TIERS: Tier[] = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
export const TIER_ES: Record<string, string> = {
  IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Maestro', GRANDMASTER: 'Gran Maestro', CHALLENGER: 'Aspirante',
};
export const DIVS = ['IV', 'III', 'II', 'I'];
export const APEX = new Set<string>(['MASTER', 'GRANDMASTER', 'CHALLENGER']);
export const ROLES: Role[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
export const ROLE_ES: Record<string, string> = { TOP: 'Top', JUNGLE: 'Jungla', MIDDLE: 'Mid', BOTTOM: 'ADC', UTILITY: 'Support' };
export const ROLE_ICON: Record<string, string> = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'middle', BOTTOM: 'bottom', UTILITY: 'utility' };
// Colores por rol (paleta categórica validada para fondo oscuro; siempre acompañados de icono y texto)
export const ROLE_COLOR: Record<Role, string> = { TOP: '#3987e5', JUNGLE: '#d95926', MIDDLE: '#199e70', BOTTOM: '#c98500', UTILITY: '#d55181' };
export const LINK_LABELS: Record<string, string> = { opgg: 'OP.GG', ugg: 'U.GG', dpm: 'DPM.LOL', log: 'LeagueOfGraphs' };
export const CDRAGON = 'https://raw.communitydragon.org/latest/plugins';
export const TZ = 'Europe/Madrid';
export const QUEUE_ES: Record<string, string> = {
  420: 'SoloQ', 440: 'Flex', 400: 'Normal', 430: 'Normal', 490: 'Normal', 480: 'Normal', 450: 'ARAM', 700: 'Clash', 720: 'Clash ARAM',
  900: 'URF', 1900: 'URF', 1700: 'Arena', 1710: 'Arena', 1300: 'Nexus Blitz', 0: 'Personalizada',
};
export const queueName = (q: number | null | undefined): string | undefined => (q == null ? undefined : QUEUE_ES[q]);

// Dirección de la web: la de donde se está sirviendo (GitHub Pages o el servidor propio)
export const SITE_URL = new URL('./', location.href).href;
// En GitHub Pages el latido está en la rama "heartbeat"; en el servidor propio, en api/latido
export const ON_PAGES = location.hostname.endsWith('github.io');

// ---------------------------------------------------------------- formatos
export const fmt = (n: number | null | undefined, d = 1): string => (n == null || Number.isNaN(n) ? '–' : Number(n).toFixed(d).replace(/\.0+$/, ''));
export const fmtInt = (n: number | null | undefined): string => (n == null ? '–' : Number(n).toLocaleString('es-ES'));
export const signed = (n: number | null | undefined): string => (n != null && n > 0 ? `+${n}` : `${n}`);
export const goldK = (v: number | null | undefined, sign = true): string => (v == null ? '–' : `${sign ? (v > 0 ? '+' : v < 0 ? '−' : '') : ''}${(Math.abs(v) / 1000).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k`);
export const pct = (w: number, n: number): number => (n ? (w / n) * 100 : 0);
export const plural = (n: number, one: string, many = `${one}s`): string => `${fmtInt(n)} ${n === 1 ? one : many}`;
export const mmss = (sec: number): string => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------- fechas
const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = (t: number): string => dayFmt.format(new Date(t));
export const prettyDay = (key: string): string => new Date(`${key}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const shortDate = (t: number): string => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: TZ });
export const dateTime = (t: number): string => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });

// Inicio de día, semana (lunes) y mes en hora de Madrid
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
const WD: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
interface Parts { y: number; m: number; d: number; hh: number; mm: number; ss: number; wd: number }
export function madridParts(t: number): Parts {
  const p: Record<string, string> = {};
  for (const x of partsFmt.formatToParts(new Date(t))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second, wd: WD[p.weekday] ?? 0 };
}
function madridMidnight(y: number, m: number, d: number): number {
  const off = (t: number) => { const p = madridParts(t); return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(t / 1000) * 1000; };
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - off(guess);
  t = guess - off(t);
  return t;
}
export const dayStartMs = (t: number): number => { const p = madridParts(t); return madridMidnight(p.y, p.m, p.d); };
export const weekStartMs = (t: number): number => { const p = madridParts(t); return madridMidnight(p.y, p.m, p.d - p.wd); };
export const monthStartMs = (t: number): number => { const p = madridParts(t); return madridMidnight(p.y, p.m, 1); };
export function weekKeyOf(t: number): string {
  const p = madridParts(t);
  const date = new Date(Date.UTC(p.y, p.m - 1, p.d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - first.getTime()) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
export function rangeLabel(from: number, toExcl: number): string {
  const a = madridParts(from), b = madridParts(toExcl - 1);
  return a.m === b.m ? `${a.d}–${b.d} ${MONTHS_ES[b.m - 1]}` : `${a.d} ${MONTHS_ES[a.m - 1]} – ${b.d} ${MONTHS_ES[b.m - 1]}`;
}

export function timeAgo(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const hrs = Math.round(min / 60);
  return hrs < 48 ? `hace ${hrs} h` : `hace ${Math.round(hrs / 24)} días`;
}
export const ago = (t: number): string => timeAgo(new Date(t).toISOString());

// ---------------------------------------------------------------- rangos
export function rankScore(rank: Rank | null | undefined): number {
  if (!rank?.tier) return -1;
  if (APEX.has(rank.tier)) return 2800 + rank.lp;
  return TIERS.indexOf(rank.tier) * 400 + DIVS.indexOf(rank.division) * 100 + rank.lp;
}
export function rankName(rank: Rank | null | undefined): string {
  if (!rank) return 'Sin clasificar';
  const n = TIER_ES[rank.tier] ?? rank.tier;
  return APEX.has(rank.tier) ? n : `${n} ${rank.division}`;
}
// Para puntos antiguos del historial solo tenemos la puntuación.
export function scoreLabel(score: number): string {
  if (score >= 2800) return `Maestro+ · ${score - 2800} LP`;
  const t = Math.floor(score / 400), d = Math.floor((score % 400) / 100);
  return `${TIER_ES[TIERS[t]]} ${DIVS[d]} · ${score % 100} LP`;
}
export const tierKey = (rank: Rank | null | undefined): string => (rank?.tier ? rank.tier.toLowerCase() : 'unranked');
export function nextDivision(rank: Rank | null): string | null {
  if (!rank || APEX.has(rank.tier)) return null;
  const d = DIVS.indexOf(rank.division);
  if (d < 3) return `${TIER_ES[rank.tier]} ${DIVS[d + 1]}`;
  const t = TIERS.indexOf(rank.tier);
  return t + 1 < 7 ? `${TIER_ES[TIERS[t + 1]]} IV` : 'Maestro';
}

// ---------------------------------------------------------------- historial de LP
// lpHist = [[timestamp, score], ...] ordenado; un punto por cada cambio de elo.
// Elo al empezar un periodo: el último punto anterior o, si no hay, el primero del periodo.
export function scoreAtStart(hist: LpPoint[] | undefined, t0: number): number | null {
  if (!hist?.length) return null;
  let base: number | null = null;
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
export function dailyDeltas(hist: LpPoint[] | undefined): { day: string; delta: number; end: number }[] {
  const out: { day: string; delta: number; end: number }[] = [];
  if (!hist?.length) return out;
  const byDay = new Map<string, number>();
  for (const [t, s] of hist) byDay.set(dayKey(t), s); // último valor de cada día
  const days = [...byDay.keys()].sort();
  for (let i = 1; i < days.length; i++) {
    out.push({ day: days[i], delta: byDay.get(days[i])! - byDay.get(days[i - 1])!, end: byDay.get(days[i])! });
  }
  return out;
}

// Porcentajes enteros que suman exactamente 100 (método del mayor resto)
export function pct100(counts: number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) out[i]++; });
  return out;
}

// Winrate ajustado: añade partidas "fantasma" al 50 % para que 3 de 3 no gane a 30 de 50.
export const adjWr = (wins: number, games: number, prior = 5): number => ((wins + prior) / (games + prior * 2)) * 100;

/** Atributo aria-* al estilo de h() (vacío si es verdadero, ausente si no): se esparce en el elemento */
export const ariaFlag = (name: `aria-${string}`, on: unknown): Record<string, string> => (on ? { [name]: '' } : {});
/** px para los estilos */
export const px = (n: number): string => `${n}px`;

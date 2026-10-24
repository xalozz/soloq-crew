// Fechas en hora de Madrid (semanas de lunes a domingo, meses naturales).

export const TZ = 'Europe/Madrid';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});
const WEEKDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// { y, m (1-12), d, hh, mm, ss, wd (lunes = 0) } en hora de Madrid
export function madridParts(t) {
  const p = {};
  for (const x of partsFmt.formatToParts(new Date(t))) p[x.type] = x.value;
  return {
    y: Number(p.year), m: Number(p.month), d: Number(p.day),
    hh: Number(p.hour) % 24, mm: Number(p.minute), ss: Number(p.second), wd: WEEKDAY[p.weekday] ?? 0,
  };
}

// Diferencia (ms) entre la hora de Madrid y UTC en el instante t
function offsetAt(t) {
  const p = madridParts(t);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(t / 1000) * 1000;
}

// Instante (ms) de las 00:00 de Madrid del día y-m-d (admite días fuera de rango, p. ej. d = 0 o 32)
export function madridMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // corrige el día del cambio de hora
  return t;
}

export function dayStart(t) {
  const p = madridParts(t);
  return madridMidnight(p.y, p.m, p.d);
}

// Lunes 00:00 (Madrid) de la semana que contiene t
export function weekStart(t) {
  const p = madridParts(t);
  return madridMidnight(p.y, p.m, p.d - p.wd);
}

export function monthStart(t) {
  const p = madridParts(t);
  return madridMidnight(p.y, p.m, 1);
}

// Fecha "YYYY-MM-DD" → 00:00 de Madrid de ese día
export function parseDay(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return madridMidnight(y, m, d);
}

// Semana ISO ("2026-W43") del día de Madrid que contiene t
export function weekKey(t) {
  const p = madridParts(t);
  const date = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const day = (date.getUTCDay() + 6) % 7; // lunes = 0
  date.setUTCDate(date.getUTCDate() - day + 3); // jueves de esa semana
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 864e5 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
export function shortDay(t) {
  const p = madridParts(t);
  return `${p.d} ${MONTHS[p.m - 1]}`;
}
// "19–25 oct" o "27 oct – 2 nov"
export function rangeLabel(from, toExclusive) {
  const a = madridParts(from), b = madridParts(toExclusive - 1);
  return a.m === b.m ? `${a.d}–${b.d} ${MONTHS[b.m - 1]}` : `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]}`;
}

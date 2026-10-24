// Retos entre los del grupo (config/challenges.json).
//   race      quién gana más LP entre dos fechas
//   target    llegar a un rango antes de una fecha ("target": "DIAMOND IV")
//   handicap  cada uno con su objetivo de LP ("targets": { "Nombre": 150 }, "target": 100 por defecto)
//   games     constancia: al menos "perWeek" partidas cada semana
// Las fechas son días (YYYY-MM-DD, hora de Madrid) y "to" se incluye entero.

import { parseDay, weekStart } from './time.mjs';
import { rankScore } from './stats.mjs';
import { eventText, COLOR, scoreLabel, signed } from './events.mjs';
import { SITE } from './discord.mjs';

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];

// "DIAMOND IV" / "Diamante IV" / "MASTER" → puntuación
const ES = { HIERRO: 'IRON', BRONCE: 'BRONZE', PLATA: 'SILVER', ORO: 'GOLD', PLATINO: 'PLATINUM', ESMERALDA: 'EMERALD', DIAMANTE: 'DIAMOND', MAESTRO: 'MASTER' };
export function parseRank(s) {
  const [t0, d0] = String(s).trim().toUpperCase().split(/\s+/);
  const tier = ES[t0] ?? t0;
  if (!TIERS.includes(tier)) return null;
  return rankScore({ tier, division: d0 || 'IV', lp: 0 });
}

function scoreAt(points, t) {
  let v = null;
  for (const [pt, s] of points) {
    if (pt <= t) v = s;
    else break;
  }
  return v;
}

export function challengeWindow(def) {
  const from = parseDay(def.from);
  const [y, m, d] = String(def.to).split('-').map(Number);
  const to = parseDay(`${y}-${m}-${d + 1}`); // fin del día "to"
  return { from, to };
}

export function challengeStatus(def, now = Date.now()) {
  const { from, to } = challengeWindow(def);
  return now < from ? 'upcoming' : now < to ? 'active' : 'finished';
}

// ctx.players: [{ name, points: [[t, score, total]], games: [...] }]
export function computeChallenges(defs, ctx, now = Date.now()) {
  const out = [];
  for (const def of defs ?? []) {
    if (!def?.id || !def.from || !def.to || !def.type) continue;
    const { from, to } = challengeWindow(def);
    const cutoff = Math.min(now, to);
    const names = def.players === 'all' || !Array.isArray(def.players) ? ctx.players.map((p) => p.name) : def.players;
    const parts = ctx.players.filter((p) => names.includes(p.name));
    const finished = now >= to;
    const started = now >= from;

    const standings = parts.map((p) => {
      const start = scoreAt(p.points, from) ?? p.points.find(([t]) => t >= from)?.[1] ?? null;
      const end = started ? scoreAt(p.points, cutoff) : start;
      const games = p.games.filter((g) => g.t >= from && g.t < cutoff);
      const gained = start != null && end != null ? end - start : null;
      const base = { name: p.name, start, end, games: games.length, wins: games.filter((g) => g.win).length };
      if (def.type === 'race') {
        return { ...base, value: gained ?? 0, label: gained == null ? 'sin datos' : `${signed(gained)} LP` };
      }
      if (def.type === 'target') {
        const target = parseRank(def.target);
        const hit = started ? p.points.find(([t, s]) => t >= from && t <= cutoff && s >= target) : null;
        const already = start != null && start >= target;
        const progress = already || hit ? 1 : start != null && end != null && target > start ? Math.max(0, (end - start) / (target - start)) : 0;
        return { ...base, target, value: progress, done: !!(already || hit), at: already ? from : hit?.[0] ?? null,
          label: already ? 'ya estaba' : hit ? '¡conseguido!' : end != null ? `${Math.max(0, target - end)} LP para llegar` : 'sin datos' };
      }
      if (def.type === 'handicap') {
        const goal = Number(def.targets?.[p.name] ?? def.target ?? 100);
        const progress = gained == null ? 0 : Math.max(0, gained) / Math.max(1, goal);
        return { ...base, goal, value: progress, done: progress >= 1,
          label: gained == null ? 'sin datos' : `${signed(gained)} de +${goal} LP` };
      }
      if (def.type === 'games') {
        const per = Number(def.perWeek ?? 10);
        const weeks = [];
        for (let w = weekStart(from); w < Math.min(to, Math.max(cutoff, from + 1)); w += 7 * 864e5) {
          const wEnd = w + 7 * 864e5;
          weeks.push(p.games.filter((g) => g.t >= Math.max(w, from) && g.t < Math.min(wEnd, to)).length);
        }
        const doneWeeks = weeks.filter((n) => n >= per).length;
        return { ...base, per, weeks, value: doneWeeks, current: weeks.at(-1) ?? 0,
          label: `${doneWeeks} de ${weeks.length} semana${weeks.length === 1 ? '' : 's'} cumplida${weeks.length === 1 ? '' : 's'}` };
      }
      return base;
    });

    const order = {
      race: (a, b) => b.value - a.value || b.wins - a.wins,
      target: (a, b) => (b.done ? 1 : 0) - (a.done ? 1 : 0) || (a.at ?? Infinity) - (b.at ?? Infinity) || b.value - a.value,
      handicap: (a, b) => b.value - a.value,
      games: (a, b) => b.value - a.value || b.games - a.games,
    }[def.type] ?? (() => 0);
    standings.sort(order);

    let winners = null;
    if (finished && standings.length) {
      if (def.type === 'target') winners = standings.filter((s) => s.done && s.label !== 'ya estaba').slice(0, 1).map((s) => s.name);
      else if (def.type === 'games') winners = standings.filter((s) => s.value === standings[0].value && s.value > 0).map((s) => s.name);
      else winners = standings.filter((s) => s.value === standings[0].value && s.value > 0).map((s) => s.name);
    }
    out.push({
      id: def.id, title: def.title ?? def.id, type: def.type, desc: def.desc ?? '', stake: def.stake ?? '',
      from, to, target: def.target ?? null, perWeek: def.perWeek ?? null,
      standings, winners,
    });
  }
  return out;
}

// Mensajes de Discord al empezar y al terminar un reto
export function challengeEvent(c, phase, now = Date.now()) {
  const e = { type: phase === 'start' ? 'challengeStart' : 'challengeEnd', t: now, title: c.title, winners: c.winners ?? [], name: '', key: c.id };
  e.id = `${e.type}:${c.id}`;
  e.text = eventText(e);
  const lines = [];
  if (c.desc) lines.push(c.desc);
  if (c.stake) lines.push(`En juego: **${c.stake}**`);
  if (phase === 'end') {
    lines.push('', ...c.standings.slice(0, 8).map((s, i) => `${i + 1}. ${s.name} · ${s.label}`));
  }
  e.desc = lines.join('\n');
  return e;
}

export function challengeEmbed(e) {
  return {
    title: e.text, url: `${SITE}#retos`, color: e.type === 'challengeEnd' ? COLOR.gold : COLOR.accent,
    description: e.desc || undefined, timestamp: new Date(e.t).toISOString(),
  };
}

export { scoreLabel };

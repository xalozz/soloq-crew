// Genera spec.json (guion con datos reales) a partir de ../data/data.json
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const here = (f) => new URL(f, import.meta.url);
const d = JSON.parse(readFileSync(here('../data/data.json'), 'utf8'));

const TIER = { IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Maestro' };
const COLOR = { GOLD: '#e0a93f', PLATINUM: '#3fc1b0', EMERALD: '#2bd071', DIAMOND: '#7d95ff', MASTER: '#b25cff' };
const CHAMP_NAME = { Chogath: "Cho'Gath", MonkeyKing: 'Wukong' };
const cn = (c) => CHAMP_NAME[c] ?? c;
const n = (x) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dec = (x, k = 1) => x.toFixed(k).replace('.', ',');
const acc = (name) => { const p = d.players.find((x) => x.name === name); return p.accounts[p.bestAccount ?? 0]; };
const seasonGames = (a) => a.rank.wins + a.rank.losses;
const hours = (a) => seasonGames(a) * a.stats.avgDurationMin / 60;
const rankTxt = (a) => `${TIER[a.rank.tier]} ${a.rank.division}`;
const voLen = (c) => Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${here(`assets/vo/${c}.ogg`).pathname.slice(1)}"`).toString().trim());

// --- tipos de dato
const vs = (a, champ, lane, extra = {}) => { const [g, w] = a.stats.vs[champ]; return { label: `Contra ${cn(champ)}`, big: `${w}V ${g - w}D`, sub: `su némesis en ${lane}`, champ, ...extra }; };
const worst = (a, extra = {}) => { const g = a.stats.worstGame; return { label: 'Peor partida', big: `${g.k}/${g.d}/${g.a}`, sub: `con ${cn(g.champ)}`, champ: g.champ, deaths: g.d, ...extra }; };
const thrown = (a, extra = {}) => { const g = a.stats.gold.biggestThrow; return { label: 'Ventaja tirada', big: n(g.val), val: g.val, unit: 'de oro', sub: `con ${cn(g.champ)}, minuto ${g.min}. Derrota.`, champ: g.champ, gag: 'gold', ...extra }; };
const streak = (a) => ({ label: 'Peor racha', big: `${a.stats.streak.worstLoss}`, unit: 'derrotas seguidas', gag: 'stamps', count: a.stats.streak.worstLoss });

function player(name, mk, closing, closing2) {
  const a = acc(name);
  return {
    name, icon: a.profileIconId, tier: a.rank.tier.toLowerCase(), color: COLOR[a.rank.tier] ?? '#c8c8d0',
    rank: `${rankTxt(a)} · ${a.rank.lp} LP`, stats: mk(a), closing: closing(a), closing2: closing2 ?? null,
  };
}

const cast = [
  player('FesAo 11', (a) => [
    vs(a, 'Mel', 'mid', { gag: 'reflect', vo: true }),
    worst(a, { gag: 'deaths' }),
    thrown(a),
  ], (a) => `Primera partida del día: ${Math.round(a.stats.firstOfDay.winrate)} %. Las demás: ${Math.round(a.stats.firstOfDay.restWinrate)} %.`),

  player('El Desgracias v2', (a) => [
    streak(a),
    vs(a, 'Aurora', 'mid'),
    worst(a, { gag: 'slash', vo: true }),
  ], (a) => `${n(hours(a))} horas de partida desde enero. ${rankTxt(a)}.`),

  player('xALOzZ', (a) => [
    { label: 'Últimas 20 partidas', big: `${a.stats.last20.wins}V ${a.stats.last20.losses}D`, sub: `${Math.round(a.stats.last20.winrate)} % de victorias`, gag: 'chart', points: a.lpHist.slice(-30).map((x) => x[1]) },
    vs(a, 'Caitlyn', 'bot', { gag: 'crosshair', vo: true }),
    thrown(a),
  ], (a) => `Racha actual: ${a.stats.streak.current.count} ${a.stats.streak.current.type === 'L' ? 'derrotas' : 'victorias'}.`),

  player('xPeris', (a) => [
    worst(a, { gag: 'crack', vo: true }),
    vs(a, 'Shen', 'support'),
    thrown(a),
  ], (a) => `${n(seasonGames(a))} partidas. ${n(hours(a))} horas desde enero. ${rankTxt(a)}.`),

  player('xPATQ', (a) => {
    const o = a.stats.champs.find((c) => c.key === 'Ornn');
    return [
      streak(a),
      { label: 'Con Ornn', big: `${o.wins}V ${o.games - o.wins}D`, sub: 'Sigue jugándolo.', champ: 'Ornn', gag: 'hammer', vo: true },
      { label: 'Derrotas por rendición', big: `${Math.round(a.stats.conduct.ffPct)} %`, sub: 'el que más se rinde del grupo', gag: 'flag' },
    ];
  }, () => 'Premio al más cobarde.'),

  player('ArNOOBal', (a) => [
    { label: 'Pings por partida', big: dec(a.stats.conduct.pings), sub: 'el que más del grupo', gag: 'pings' },
    (() => { const g = a.stats.gold.biggestThrow; return thrown(a, { sub: `con ${cn(g.champ)}, ${g.k}/${g.d}/${g.a}. Derrota.`, vo: true }); })(),
    vs(a, 'Ivern', 'jungla'),
  ], (a) => `${n(hours(a))} horas de partida desde enero. A ${100 - a.rank.lp} LP de Diamante.`),

  player('Teyeno tuniña', (a) => [
    { label: 'Pings de "?" por partida', big: dec(a.stats.conduct.q), sub: 'el que más del grupo', gag: 'questions' },
    vs(a, 'Syndra', 'mid', { gag: 'spheres', vo: true }),
    worst(a, { gag: 'deaths' }),
  ], () => 'El mejor del grupo.', 'Imagínate el resto.'),
];

// --- tiempos de cada escena
const S1 = 2.6;
for (const p of cast) {
  let t = S1;
  for (const s of p.stats) {
    s.gag ??= 'none';
    s.sfx = !!s.champ;
    s.voLen = s.vo ? voLen(s.champ) : 0;
    s.dur = Math.max(s.gag === 'none' ? 2.3 : 2.9, s.vo ? s.voLen + 0.7 : 0);
    s.at = Math.round(t * 30) / 30; t += s.dur; s.dur = Math.round(s.dur * 30) / 30;
    if (s.champ) s.champName = cn(s.champ);
  }
  p.closeAt = Math.round(t * 30) / 30;
  p.dur = p.closeAt + (p.closing2 ? 4.6 : 3.0);
}

const all = d.players.map((p) => p.accounts[p.bestAccount ?? 0]);
const totalGames = all.reduce((s, a) => s + seasonGames(a), 0);
const totalHours = all.reduce((s, a) => s + hours(a), 0);
const spec = {
  intro: { dur: 8, players: cast.length, games: n(totalGames), teasers: ['0/11/0', '11 DERROTAS SEGUIDAS', '5V 15D', '12.896 DE ORO', '60,7 PINGS'] },
  cast,
  finale: {
    dur: 13.5,
    lines: [
      [n(totalGames), 'partidas'],
      [n(totalHours), 'horas de partida'],
      [n(totalHours / 24), 'días seguidos jugando'],
      [n(all.reduce((s, a) => s + a.rank.losses, 0)), 'derrotas'],
    ],
    last: ['0', 'Challengers'],
    url: 'xalozz.github.io/soloq-crew',
  },
};
writeFileSync(here('./spec.json'), JSON.stringify(spec, null, 1));
for (const p of cast) {
  console.log(`\n${p.name} — ${p.rank} — ${p.dur.toFixed(1)} s`);
  for (const s of p.stats) console.log(`  ${s.at.toFixed(2)}  ${s.label}: ${s.big} ${s.unit ?? ''} | ${s.sub ?? ''} [${s.gag}${s.vo ? ' +voz' : ''}]`);
  console.log(`  ${p.closeAt.toFixed(2)}  «${p.closing}» ${p.closing2 ? `«${p.closing2}»` : ''}`);
}
console.log('\nFinal:', spec.finale.lines.map((l) => l.join(' ')).join(' · '));
console.log('Duración total:', (spec.intro.dur + cast.reduce((s, p) => s + p.dur, 0) + spec.finale.dur).toFixed(1), 's');

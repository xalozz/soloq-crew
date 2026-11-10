import { readFileSync, writeFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(new URL('../data/data.json', import.meta.url), 'utf8'));
const TIER = { IRON: 'Hierro', BRONZE: 'Bronce', SILVER: 'Plata', GOLD: 'Oro', PLATINUM: 'Platino', EMERALD: 'Esmeralda', DIAMOND: 'Diamante', MASTER: 'Maestro' };
const COLOR = { GOLD: '#d9a441', PLATINUM: '#3fb6a8', EMERALD: '#2bbf6a', DIAMOND: '#6f8cff', MASTER: '#b25cff' };
const n = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const acc = (name) => { const p = d.players.find((x) => x.name === name); return p.accounts[p.bestAccount ?? 0]; };
const total = d.players.reduce((s, p) => s + p.accounts[p.bestAccount ?? 0].stats.games, 0);
const hours = (s) => Math.round(s.games * s.avgDurationMin / 60);
const vsOf = (s, c) => s.vs[c];
function player(name, stats, closing) {
  const a = acc(name);
  return { name, initial: name[0], icon: a.profileIconId, tier: a.rank.tier, color: COLOR[a.rank.tier] ?? '#c8c8d0',
    rank: `${TIER[a.rank.tier]} ${a.rank.division} · ${a.rank.lp} LP`, stats, closing };
}
const A = acc('xALOzZ').stats, D = acc('El Desgracias v2').stats;
const [cn, cw] = vsOf(A, 'Caitlyn'), [an, aw] = vsOf(D, 'Aurora');
const spec = {
  total: n(total), players: 7,
  cast: [
    player('xALOzZ', [
      { label: 'Últimas 20 partidas', big: `${A.last20.wins}V ${A.last20.losses}D`, sub: `${A.last20.winrate} % de victorias` },
      { label: 'Contra Caitlyn', big: `${cw}V ${cn - cw}D`, sub: 'su némesis en bot' },
      { label: 'Ventaja tirada', big: `${n(A.gold.biggestThrow.val)}`, unit: 'de oro', sub: `con ${A.gold.biggestThrow.champ} en el minuto ${A.gold.biggestThrow.min}. Perdió.` },
    ], `Racha actual: ${A.streak.current.count} derrotas.`),
    player('El Desgracias v2', [
      { label: 'Peor racha', big: `${D.streak.worstLoss}`, unit: 'derrotas seguidas' },
      { label: 'Contra Aurora', big: `${aw}V ${an - aw}D`, sub: 'su némesis en mid' },
      { label: 'Peor partida', big: `${D.worstGame.k}/${D.worstGame.d}/${D.worstGame.a}`, sub: `con ${D.worstGame.champ}` },
    ], `${n(hours(D))} horas jugadas. ${TIER[acc('El Desgracias v2').rank.tier]} ${acc('El Desgracias v2').rank.division}.`),
  ],
};
writeFileSync(new URL('./spec.json', import.meta.url), JSON.stringify(spec, null, 2));
console.log(JSON.stringify(spec, null, 1));

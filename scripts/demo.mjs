// Genera datos inventados a partir de config/players.json para previsualizar la web sin clave de Riot.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { profileLinks } from './riot.mjs';
import { computeAccountStats, pickBestAccount, rankScore } from './stats.mjs';

const CHAMPS = ['Ahri', 'Jinx', 'Lux', 'Yasuo', 'Thresh', 'LeeSin', 'Ezreal', 'Darius', 'Ashe', 'Zed', 'Sett', 'Caitlyn', 'MissFortune', 'Viego', 'Kaisa', 'Garen', 'Lulu', 'Nautilus', 'Sylas', 'Vi'];
const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const DIVS = ['IV', 'III', 'II', 'I'];

// PRNG determinista (mulberry32) para que la demo sea estable.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

function fakeHistory(rand, skill, n) {
  const favs = [0, 1, 2].map(() => CHAMPS[Math.floor(rand() * CHAMPS.length)]);
  const mainRole = ROLES[Math.floor(rand() * ROLES.length)];
  const now = Date.now();
  const out = [];
  for (let i = 0; i < n; i++) {
    const champ = rand() < 0.7 ? favs[Math.floor(rand() * favs.length)] : CHAMPS[Math.floor(rand() * CHAMPS.length)];
    const win = rand() < skill;
    const dur = 1300 + Math.floor(rand() * 1100);
    const k = Math.floor(rand() * (win ? 14 : 9));
    const d = Math.floor(rand() * (win ? 7 : 12));
    const a = Math.floor(rand() * 15);
    const dmg = 8000 + Math.floor(rand() * 25000);
    out.push({
      id: `DEMO_${i}`, t: now - i * (3600e3 * (2 + rand() * 20)), dur, win, champ,
      role: rand() < 0.75 ? mainRole : ROLES[Math.floor(rand() * ROLES.length)],
      k, d, a, cs: Math.floor((dur / 60) * (4 + rand() * 4)), vis: Math.floor((dur / 60) * (0.6 + rand() * 1.2)),
      dmg, teamDmg: dmg * (2.5 + rand() * 2),
    });
  }
  return out;
}

export async function writeDemo(configPath, outPath) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const players = config.players.map((pl) => {
    const accounts = pl.accounts.map((acc) => {
      const rand = rng(hash(acc.riotId));
      const region = acc.region ?? config.defaultRegion ?? 'euw1';
      const i = acc.riotId.lastIndexOf('#');
      const gameName = acc.riotId.slice(0, i), tagLine = acc.riotId.slice(i + 1);
      const skill = 0.42 + rand() * 0.22;
      const history = fakeHistory(rand, skill, 30 + Math.floor(rand() * 60));
      const wins = 40 + Math.floor(rand() * 120), losses = 40 + Math.floor(rand() * 120);
      return {
        riotId: acc.riotId, gameName, tagLine, label: acc.label ?? null, region,
        level: 60 + Math.floor(rand() * 400), profileIconId: 1 + Math.floor(rand() * 28),
        rank: {
          tier: TIERS[Math.floor(rand() * TIERS.length)], division: DIVS[Math.floor(rand() * 4)],
          lp: Math.floor(rand() * 100), wins, losses,
          winrate: Math.round((wins / (wins + losses)) * 1000) / 10, hotStreak: rand() < 0.2,
        },
        stats: computeAccountStats(history),
        links: profileLinks(region, gameName, tagLine),
        updatedAt: new Date().toISOString(),
      };
    });
    for (const a of accounts) {
      const sc = rankScore(a.rank);
      a.lpHist = [[Date.now() - 2 * 864e5, sc - 60], [Date.now() - 864e5, sc - 25], [Date.now() - 3600e3, sc]];
    }
    const { index, score } = pickBestAccount(accounts);
    return { name: pl.name, links: pl.links ?? [], bestAccount: index, score, accounts };
  });
  players.sort((a, b) => b.score - a.score);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    ddragonVersion: '15.19.1',
    demo: true,
    title: config.title ?? 'SoloQ Crew',
    subtitle: config.subtitle ?? '',
    players,
  }, null, 2) + '\n');
}
